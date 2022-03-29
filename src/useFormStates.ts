import { useCallback, useMemo, useRef } from "react";
import { createObjectState, ObjectConfig, ObjectState, ObjectStateInternal } from "src/formState";
import { initValue } from "src/utils";

export type ObjectStateCache<T, I> = Record<string, [ObjectState<T>, I]>;

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
};

export function useFormStates<T, I = T>(opts: UseFormStatesOpts<T, I>): { getFormState: (input: I) => ObjectState<T> } {
  const { config, autoSave, getId, map, addRules } = opts;

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

  const getFormState = useCallback(
    (input: I) => {
      const existing = objectStateCache[getId(input)];
      let form = existing?.[0];

      async function maybeAutoSave(form: ObjectState<T>) {
        // Don't use canSave() because we don't want to set touched for all the fields
        if (autoSaveRef.current && form.dirty && form.valid) {
          const { current: pending } = pendingAutoSaves;
          if (isAutoSaving) {
            pending.add(form);
            return;
          }
          try {
            isAutoSaving = true;
            // See if we have any reactions that want to run (i.e. added by addRules hooks)
            await new Promise((resolve) => setTimeout(resolve, 0));
            // If a reaction re-queued our form during the ^ wait, remove it
            pending.delete(form);
            await autoSaveRef.current(form);
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
        form = createObjectState(config, initValue(config, map ? { map, input } : input), {
          maybeAutoSave: () => maybeAutoSave(form),
        });
        if (addRules) {
          addRules(form);
        }
        objectStateCache[getId(input)] = [form, input];
      }

      // If the source of truth changed, then update the existing state and return it.
      if (existing && existing[1] !== input) {
        (form as ObjectStateInternal<any>).set(initValue(config, map ? { map, input } : input), { refreshing: true });
        existing[1] = input;
      }

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
