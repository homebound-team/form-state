import { useMemo, useRef } from "react";
import { createObjectState, ObjectConfig, ObjectState, ObjectStateInternal } from "src/formState";
import { initValue } from "src/utils";

export type ObjectStateCache<T, I> = Record<string, [ObjectState<T>, I]>;

type UseFormStatesOpts<T, I> = {
  config: ObjectConfig<T>;

  /** Fired for each individual `ObjectState` when it's had a value change. */
  autoSave?: (state: ObjectState<T>) => Promise<void>;

  /**
   * A hook to add custom, cross-field validation rules that can be difficult to setup directly in the config DSL.
   *
   * Does not need to be stable/useMemo'd.
   */
  addRules?: (state: ObjectState<T>) => void;

  /** Given an input to `getObjectState`, returns the identity value that we'll cache that value's form state on. */
  getId: (v: I) => string;

  /** Maps an input to `getObjectState` to the actual form shape `T`. */
  map?: (input: Exclude<I, null | undefined>) => T;
};

export function useFormStates<T, I>(opts: UseFormStatesOpts<T, I>): { getObjectState: (input: I) => ObjectState<T> } {
  const { config, autoSave, getId, map, addRules } = opts;
  const objectStateCache = useMemo<ObjectStateCache<T, I>>(() => ({}), [config]);
  // Keep track of ObjectStates that triggered auto-save when a save was already in progress.
  const pendingAutoSaves = useRef<ObjectState<T>[]>([]);

  // Use a ref so our memo'ized `autoSave` always see the latest value
  const autoSaveRef = useRef<((state: ObjectState<T>) => void) | undefined>(autoSave);
  autoSaveRef.current = autoSave;

  async function maybeAutoSave(form: ObjectState<T>) {
    if (isAutoSaving && !pendingAutoSaves.current.includes(form)) {
      pendingAutoSaves.current.push(form);
    }

    // Don't use canSave() because we don't want to set touched for all the fields
    if (autoSaveRef.current && form.dirty && form.valid && !isAutoSaving) {
      try {
        isAutoSaving = true;
        await autoSaveRef.current(form);
      } finally {
        isAutoSaving = false;

        if (pendingAutoSaves.current.length > 0) {
          await maybeAutoSave(pendingAutoSaves.current.shift()!);
        }
      }
    }
  }

  return {
    getObjectState: (input) => {
      const existing = objectStateCache[getId(input)];
      let form = existing?.[0];

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
  };
}

// If the user's autoSave hook makes some last-minute `.set` calls to sneak
// in some business logic right before their GraphQL mutation call, ignore it
// so that we don't infinite loop.
let isAutoSaving = false;
