import { useMemo, useRef } from "react";
import { createObjectState, ObjectConfig, ObjectState } from "src/formState";
import { initValue } from "src/utils";

export type ObjectStateCache<T, I> = Record<string, [ObjectState<T>, I]>;
type UseFormStatesOpts<T, I> = {
  config: ObjectConfig<T>;
  autoSave?: (state: ObjectState<T>) => Promise<void>;
  getId: (v: I) => string;
  map?: (input: Exclude<I, null | undefined>) => T;
};
export function useFormStates<T, I>(opts: UseFormStatesOpts<T, I>): { getObjectState: (input: I) => ObjectState<T> } {
  const { config, autoSave, getId, map } = opts;
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
      const form: ObjectState<T> = existing
        ? existing[0]
        : createObjectState(config, initValue(config, map ? { map, input } : input), {
            maybeAutoSave: () => maybeAutoSave(form),
          });

      // If it didn't exist, then add to the cache.
      if (!existing) {
        objectStateCache[getId(input)] = [form, input];
      }

      // If the source of truth changed, then update the existing state and return it.
      if (existing && existing[1] !== input) {
        (existing[0] as any).set(initValue(config, map ? { map, input } : input), { refreshing: true });
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
