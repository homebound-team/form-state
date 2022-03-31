import { isPlainObject } from "is-plain-object";
import { useEffect, useMemo, useRef, useState } from "react";
import { ObjectConfig } from "src/config";
import { createObjectState, ObjectState } from "src/fields/objectField";
import { initValue } from "./utils";

export type UseFormStateOpts<T, I> = {
  /** The form configuration, should be a module-level const or useMemo'd. */
  config: ObjectConfig<T>;

  /**
   * Provides the form's initial value.
   *
   * User's can either:
   *
   * - Provide no initial value (don't set `init` at all)
   * - Provide an initial value that already matches the form type `T` (i.e. set `init: data`)
   * - Provide an initial value from an object that _almost_ matches the form type `T`,
   *   but needs to be mapped from it's input type `I` to the form type
   *   (i.e. set `init: { input: data, map: (data) => ...}`).
   *
   * The value of using the 3rd option is that: a) we internally `useMemo` on the identity of the
   * `init.input` (i.e. a response from an Apollo hook) and don't require the `map` function
   * to have a stable identity, and also b) we will null-check/undefined-check `init.input` and
   * only call `init.map` if it's set, otherwise we'll use `init.ifDefined` or `{}`, saving you
   * from having to null check within your `init.map` function.
   */
  init?:
    | T
    | {
        input: I;
        map: (input: Exclude<I, null | undefined>) => T;
        ifUndefined?: T;
      };

  /**
   * A hook to add custom, cross-field validation rules that can be difficult to setup directly in the config DSL.
   *
   * Does not need to be stable/useMemo'd.
   */
  addRules?: (state: ObjectState<T>) => void;

  /** Whether the form should be read only, when changed it won't re-create the whole form. */
  readOnly?: boolean;

  /**
   * Fired when the form should auto-save, i.e. after a) blur and b) all fields are valid.
   *
   * Does not need to be stable/useMemo'd.
   */
  autoSave?: (state: ObjectState<T>) => Promise<unknown>;
};

// If the user's autoSave hook makes some last-minute `.set` calls to sneak
// in some business logic right before their GraphQL mutation call, ignore it
// so that we don't infinite loop.
let isAutoSaving: "queued" | "in-flight" | false = false;

// `pendingAutoSave` is a flag for determining if we need to immediately call `maybeAutoSave` again after the initial Promise finishes
// This could happen if a field triggers auto-save while another field's auto-save is already in progress.
let pendingAutoSave = false;

/**
 * Creates a formState instance for editing in a form.
 */
export function useFormState<T, I>(opts: UseFormStateOpts<T, I>): ObjectState<T> {
  const { config, init, addRules, readOnly = false, autoSave } = opts;

  // Use a ref so our memo'ized `onBlur` always see the latest value
  const autoSaveRef = useRef<((state: ObjectState<T>) => void) | undefined>(autoSave);
  autoSaveRef.current = autoSave;

  const firstRunRef = useRef<boolean>(true);
  // This is a little weird, but we need to know ahead of time, before the form useMemo, if we're working with classes/mobx proxies
  const [firstInitValue] = useState(() => initValue(config, init));
  const isWrappingMobxProxy = !isPlainObject(firstInitValue);
  // If they're using init.input, useMemo on it (and it might be an array), otherwise allow the identity of init be unstable
  const dep = init && "input" in init && "map" in init ? (Array.isArray(init.input) ? init.input : [init.input]) : [];

  const form = useMemo(
    () => {
      function maybeAutoSave() {
        if (isAutoSaving === "in-flight") {
          pendingAutoSave = true;
        } else if (isAutoSaving === "queued") {
          return;
        }

        // Don't use canSave() because we don't want to set touched for all the fields
        if (autoSaveRef.current && form.dirty && form.valid && !isAutoSaving) {
          isAutoSaving = "queued";
          // We use setTimeout as a cheap way to wait until the end of the current event listener
          setTimeout(async () => {
            try {
              // We technically don't flip to in-flight until after the call in case the
              // user's autoSave function itself wants to call a .set.
              const promise = autoSaveRef.current!(form);
              isAutoSaving = "in-flight";
              await promise;
            } finally {
              isAutoSaving = false;
              if (pendingAutoSave) {
                pendingAutoSave = false;
                // Push out the follow-up by 1 tick to allow refreshes to happen to potentially
                // un-dirty the just-saved data (e.g. if we run right away, the caller's maybeAutoSave
                // will see a form.changedValue that thinks the just-saved data is still dirty).
                setTimeout(maybeAutoSave, 0);
              }
            }
          }, 0);
        }
      }
      const value = firstRunRef.current ? firstInitValue : initValue(config, init);
      const form = createObjectState(config, value, { maybeAutoSave });
      form.readOnly = readOnly;
      if (init && "input" in init && !("ifUndefined" in init)) {
        form.loading = init.input === undefined;
      }
      // The identity of `addRules` is not stable, but assume that it is for better UX.
      (addRules || (() => {}))(form);
      firstRunRef.current = true;
      return form;
    },
    // For this useMemo, we (almost) never re-run so that we can have a stable `form` identity across query refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, ...(isWrappingMobxProxy ? dep : [])],
  );

  // We use useEffect so that any mutations to the proxies, which will call `setState`s on any observers to
  // queue their components' render), don't happen during our render, per https://fb.me/setstate-in-render.
  useEffect(() => {
    // Ignore the 1st run b/c our 1st useMemo already initialized `form` with the current `init` value.
    // Also for mobx proxies, we recreate a new form-state every time init changes, so that our
    // fields fundamentally pointing to the right proxy. So just defer to the ^ useMemo.
    if (firstRunRef.current || isWrappingMobxProxy) {
      firstRunRef.current = false;
      return;
    }
    if (init && "input" in init && !("ifUndefined" in init)) {
      form.loading = init.input === undefined;
    }
    (form as any).set(initValue(config, init), { refreshing: true });
  }, [form, ...dep]);

  // Use useEffect so that we don't touch the form.init proxy during a render
  useEffect(() => {
    form.readOnly = readOnly;
  }, [form, readOnly]);

  return form;
}
