import { useCallback, useEffect, useMemo, useRef } from "react";
import { type ObjectConfig } from "src/config";
import { type ObjectState, type ObjectStateInternal, createInactiveObjectState } from "src/fields/objectField";
import { activateSubscriptions, deactivateSubscriptions } from "src/fields/subscriptions";
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

type FormStateOpts = { readOnly?: boolean };

export type FormStates<T, I = T> = {
  /** Gets and refreshes a cached form immediately. Use outside React renders. */
  getFormState: (input: I, opts?: FormStateOpts) => ObjectState<T>;
  /** Gets a cached form in a row component, and refreshes it after that row commits. */
  useFormState: (input: I, opts?: FormStateOpts) => ObjectState<T>;
};

/**
 * A hook to manage many "mini-forms" on a single page, typically one form per row
 * in a table.
 *
 * Unlike independent per-row `useFormState` calls, this hook shares forms by `getId` and
 * serializes autosaves across all its rows. Only one autosave callback is in flight at a time,
 * avoiding overlapping writes when different row mutations also update the same backend parent.
 * Separate `useFormStates` instances do not block each other. Rows validate and save separately;
 * this hook does not batch mutations or expose aggregate dirty/valid state.
 *
 * The table owns the cache, subscriptions, and save queue. WIP edits survive row unmounts/remounts
 * while the table stays mounted and its config stays unchanged. Removing a row does not release
 * its cached form's subscriptions or stop its queued saves. Table unmount stops new saves and
 * releases subscriptions without cancelling in-flight requests; changing config replaces the cache.
 * Prefer independent per-row `useFormState` calls if neither caching nor save coordination is needed.
 *
 * Call the returned `useFormState` hook at the top level of a row component, not in a loop or
 * column render callback. It returns a cached `ObjectState` and applies server refreshes after
 * commit, preserving WIP edits without notifying other observers during render. As with
 * `useFormState`, components that read field values must be MobX observers.
 *
 * `getFormState` remains available for imperative code that needs an immediate refresh.
 *
 * @typeparam T the form type, which is usually as close as possible to your *GraphQL input*
 * @typeparam I the *form input* type, which is usually the *GraphQL output* type, i.e. the type of the response from your GraphQL query
 */
export function useFormStates<T, I = T>(opts: UseFormStatesOpts<T, I>): FormStates<T, I> {
  const { config, autoSave, getId, map, addRules, readOnly = false } = opts;

  // Force resetting the cache if config changes.
  const cache = useMemo(
    () => ({
      config,
      forms: {} as ObjectStateCache<T, I>,
      // A suspended row can create a form without ever committing its ownership.
      committedForms: new Set<ObjectState<T>>(),
      active: false,
      // Keep paused saves with their forms so effect reconnection can resume them.
      pending: new Map<ObjectState<T>, () => Promise<void>>(),
    }),
    [config],
  );
  // A previous config's in-flight request must drain the latest committed cache, not its old queue.
  const currentCacheRef = useRef(cache);
  // If the user's autoSave hook makes some last-minute `.set` calls to sneak
  // in some business logic right before their GraphQL mutation call, ignore it
  // so that we don't infinite loop.
  //
  // This is per-hook (not module-level) so that one hook's in-flight save does not
  // swallow the auto-saves queued by an unrelated `useFormStates` on the same page.
  const isAutoSaving = useRef(false);
  // Use a ref so our memo'ized `autoSave` always see the latest value
  const autoSaveRef = useRef<UseFormStatesOpts<T, I>["autoSave"]>(autoSave);
  autoSaveRef.current = autoSave;
  // Use a ref b/c we're memod
  const readOnlyRef = useRef<boolean>(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    currentCacheRef.current = cache;
    cache.active = true;
    cache.committedForms.forEach((form) => activateSubscriptions(form));
    // Resume any auto saves that were made before/after useEffect connected our subscriptions
    Array.from(cache.pending.values()).forEach((maybeAutosave) => void maybeAutosave());
    return () => {
      // Stop queued requests immediately, without cancelling requests already in flight.
      cache.active = false;
      cache.committedForms.forEach((form) => deactivateSubscriptions(form));
    };
  }, [cache]);

  const getOrCreateFormState = useCallback(
    (input: I, opts: FormStateOpts = {}): ObjectStateCache<T, I>[string] => {
      const { config, forms: objectStateCache } = cache;
      const id = getId(input);
      const existing = objectStateCache[id];
      let form = existing?.[0];

      /**
       * Serializes this form's saves with the other rows owned by the hook.
       *
       * Each retry retains its cache so a config replacement cannot revive a released form.
       */
      async function maybeAutoSave() {
        if (!cache.active || !cache.committedForms.has(form)) {
          cache.pending.set(form, maybeAutoSave);
          return;
        }
        // Don't use form.canSave() because we don't want to set touched for all the fields
        if (autoSaveRef.current && form.dirty) {
          // It's very frustrating to not know why the form is savings, to go ahead and log these
          if (!form.valid) {
            console.debug("Skipping auto-save b/c form is invalid: ", form.errors);
            cache.pending.delete(form);
            return;
          }
          if (isAutoSaving.current) {
            cache.pending.set(form, maybeAutoSave);
            return;
          }
          try {
            isAutoSaving.current = true;
            // See if we have any reactions that want to run (i.e. added by addRules hooks)
            await new Promise((resolve) => setTimeout(resolve, 0));
            // If a reaction re-queued our form during the ^ wait, remove it
            cache.pending.delete(form);
            if (cache.active && autoSaveRef.current) {
              // A refresh or edit can change save eligibility while the timer is pending.
              if (!form.dirty || !form.valid) return;
              await autoSaveRef.current(form);
            } else {
              cache.pending.set(form, maybeAutoSave);
            }
          } finally {
            isAutoSaving.current = false;
            // Config replacement can commit a new cache while this request is in flight.
            // Only drain that current cache, and leave its queue intact if effects are disconnected.
            const currentCache = currentCacheRef.current;
            if (currentCache.active) {
              for (const [first, maybeAutosave] of currentCache.pending) {
                if (!currentCache.committedForms.has(first)) continue;
                currentCache.pending.delete(first);
                if (!first.dirty || !first.valid) continue;
                await maybeAutosave();
                break;
              }
            }
          }
        } else {
          cache.pending.delete(form);
        }
      }

      // If it didn't exist, then add to the cache.
      if (!form) {
        form = createInactiveObjectState(config, initValue(config, { map, input }), {
          maybeAutoSave,
        });
        if (addRules) {
          addRules(form);
        }
        // New forms have no observers yet, so their initial permissions are safe to set during render.
        form.readOnly = readOnlyRef.current || !!opts.readOnly;
        objectStateCache[id] = [form, input];
      }

      return objectStateCache[id];
    },
    // Allow the user to not stable-ize getId, map, addRules, and autoSave
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache],
  );

  /** Acquires table-owned subscriptions only after a row commits or an imperative caller requests it. */
  const commitFormState = useCallback(
    (form: ObjectState<T>) => {
      cache.committedForms.add(form);
      if (cache.active) {
        activateSubscriptions(form);
        void cache.pending.get(form)?.();
      }
    },
    [cache],
  );

  const getFormState = useCallback<FormStates<T, I>["getFormState"]>(
    (input, opts = {}) => {
      const entry = getOrCreateFormState(input, opts);
      refreshFormState(entry, config, input, map, readOnlyRef.current || !!opts.readOnly);
      commitFormState(entry[0]);
      return entry[0];
    },
    // Like getOrCreateFormState, capture map with the config rather than requiring a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, getOrCreateFormState, commitFormState],
  );

  const useFormState = useCallback(
    function useFormState(input: I, opts: FormStateOpts = {}): ObjectState<T> {
      const entry = getOrCreateFormState(input, opts);
      const rowReadOnly = readOnly || !!opts.readOnly;
      useEffect(() => {
        // The row may render without its table rendering, or suspend without committing.
        // Its own effect, not a table-level queue or timer, owns this refresh.
        refreshFormState(entry, config, input, map, rowReadOnly);
        commitFormState(entry[0]);
        // The cache callbacks capture config/map until the config changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [entry, input, rowReadOnly, commitFormState]);
      return entry[0];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, getOrCreateFormState, commitFormState, readOnly],
  );

  return useMemo(() => ({ getFormState, useFormState }), [getFormState, useFormState]);
}

/** Refreshes only changed server inputs; effect replay must not acknowledge unsaved observable edits. */
function refreshFormState<T, I>(
  entry: ObjectStateCache<T, I>[string],
  config: ObjectConfig<T>,
  input: I,
  map: UseFormStatesOpts<T, I>["map"],
  readOnly: boolean,
): void {
  const form = entry[0];
  // If the source of truth changed, update the existing state.
  if (entry[1] !== input) {
    (form as unknown as ObjectStateInternal<T>).set(initValue(config, { map, input }), {
      refreshing: true,
    });
    entry[1] = input;
  }
  form.readOnly = readOnly;
}
