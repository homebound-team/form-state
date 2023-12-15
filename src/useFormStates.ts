import { useCallback, useMemo, useRef } from "react";
import { ObjectConfig } from "src/config";
import { ObjectState, ObjectStateInternal, createObjectState } from "src/fields/objectField";
import { initValue } from "src/utils";

export type ObjectStateCache<T, I> = Record<string, [ObjectState<T>, I]>;

/**
 * The opts has for `useFormStates`.
 *
 * @typeparam T the form type, which is usually as close as possible to your *GraphQL input*
 * @typeparam I the *form input* type, which is usually the *GraphQL output* type, i.e. the type of the response from your GraphQL query
 */
type UseFormStatesOpts<T, I> = {
  /**
   * The config to use for each form state.
   *
   * Should be stable/useMemo'd.
   */
  config: ObjectConfig<T>;

  /**
   * Fired for each individual `ObjectState` when it's had a value change.
   *
   * Does not need to be stable/useMemo'd.
   */
  autoSave?: (state: ObjectState<T>) => Promise<void>;

  /**
   * A hook to add custom, cross-field validation rules that can be difficult to setup directly in the config DSL.
   *
   * This will be called once-per `ObjectState` instance, and so is effectively a `useEffect` hook with
   * a `[config, objectState]` dependency.
   *
   * Does not need to be stable/useMemo'd.
   */
  addRules?: (state: ObjectState<T>) => void;

  /**
   * Given an input to `getFormState`, returns the identity value that we'll cache that value's form state on.
   *
   * Does not need to be stable/useMemo'd.
   */
  getId: (v: I) => string;

  /**
   * Maps an input to `getFormState` to the actual form shape `T`.
   *
   * Does not need to be stable/useMemo'd.
   */
  map?: (input: Exclude<I, null | undefined>) => T;

  /**
   * Sets all `ObjectState`s to readOnly.
   */
  readOnly?: boolean;
};

type UseFormStatesHook<T, I> = {
  getFormState: (input: I, opts?: { readOnly?: boolean }) => ObjectState<T>;
};

/**
 * A hook to manage many "mini-forms" on a single page, typically one form per row
 * in a table.
 *
 * This hook basically provides the page/table with a cache, so each table row naively ask "what's
 * the form state for this given row's data?" and get back a new-or-existing `ObjectState` instance
 * that, if already existing, still has any of the user's WIP changes.
 *
 * Each mini-form/row can have its own autoSave calls, independent of the other rows.
 *
 * @typeparam T the form type, which is usually as close as possible to your *GraphQL input*
 * @typeparam I the *form input* type, which is usually the *GraphQL output* type, i.e. the type of the response from your GraphQL query
 */
export function useFormStates<T, I = T>(opts: UseFormStatesOpts<T, I>): UseFormStatesHook<T, I> {
  const { config, autoSave, getId, map, addRules, readOnly = false } = opts;

  const objectStateCache = useMemo<ObjectStateCache<T, I>>(
    () => ({}),
    // Force resetting the cache if config changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config],
  );
  // Keep track of ObjectStates that triggered auto-save when a save was already in progress.
  const pendingAutoSaves = useRef<Set<ObjectState<T>>>(new Set());
  // Use a ref so our memo'ized `autoSave` always see the latest value
  const autoSaveRef = useRef<UseFormStatesOpts<T, I>["autoSave"]>(autoSave);
  autoSaveRef.current = autoSave;
  // Use a ref b/c we're memod
  const readOnlyRef = useRef<boolean>(readOnly);
  readOnlyRef.current = readOnly;

  const getFormState = useCallback<UseFormStatesHook<T, I>["getFormState"]>(
    (input, opts = {}) => {
      const existing = objectStateCache[getId(input)];
      let form = existing?.[0];

      async function maybeAutoSave(form: ObjectState<T>) {
        // Don't use form.canSave() because we don't want to set touched for all the fields
        if (autoSaveRef.current && form.dirty) {
          // It's very frustrating to not know why the form is savings, to go ahead and log these
          if (!form.valid) {
            console.debug("Skipping auto-save b/c form is invalid: ", form.errors);
            return;
          }
          const { current: pending } = pendingAutoSaves;
          if (isAutoSaving) {
            pending.add(form);
            return;
          }
          let maybeError: undefined | string;
          try {
            isAutoSaving = true;
            // See if we have any reactions that want to run (i.e. added by addRules hooks)
            await new Promise((resolve) => setTimeout(resolve, 0));
            // If a reaction re-queued our form during the ^ wait, remove it
            pending.delete(form);
            await autoSaveRef.current(form);
          } catch (e) {
            maybeError = String(e);
            throw e;
          } finally {
            isAutoSaving = false;
            if (pending.size > 0) {
              const first = pending.values().next().value!;
              pending.delete(first);
              await maybeAutoSave(first);
            }
          }
        }
      }

      // If it didn't exist, then add to the cache.
      if (!form) {
        form = createObjectState(config, initValue(config, { map, input }), {
          maybeAutoSave: () => maybeAutoSave(form),
        });
        if (addRules) {
          addRules(form);
        }
        objectStateCache[getId(input)] = [form, input];
      }

      // If the source of truth changed, then update the existing state and return it.
      if (existing && existing[1] !== input) {
        (form as any as ObjectStateInternal<any>).set(initValue(config, { map, input }), {
          refreshing: true,
        });
        existing[1] = input;
      }

      form.readOnly = readOnlyRef.current || !!opts.readOnly;

      return form;
    },
    // Allow the user to not stable-ize getId, map, addRules, and autoSave
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectStateCache, config],
  );

  return { getFormState };
}

// If the user's autoSave hook makes some last-minute `.set` calls to sneak
// in some business logic right before their GraphQL mutation call, ignore it
// so that we don't infinite loop.
let isAutoSaving = false;
