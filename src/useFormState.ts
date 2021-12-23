import {isPlainObject} from "is-plain-object";
import { isObservable } from "mobx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createObjectState,
  ListFieldConfig,
  ObjectConfig,
  ObjectFieldConfig,
  ObjectState,
  ValueFieldConfig,
} from "./formState";
import { assertNever } from "./utils";

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
  autoSave?: (state: ObjectState<T>) => void;
};

let isAutoSaving = false;

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
      function onBlur() {
        // Don't use canSave() because we don't want to set touched for all of the field
        if (autoSaveRef.current && form.dirty && form.valid && !isAutoSaving) {
          try {
            isAutoSaving = true;
            autoSaveRef.current(form);
          } finally {
            isAutoSaving = false;
          }
        }
      }
      const value = firstRunRef.current ? firstInitValue : initValue(config, init);
      const form = createObjectState(config, value, { onBlur });
      form.readOnly = readOnly;
      // The identity of `addRules` is not stable, but assume that it is for better UX.
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
    (form as any).set(initValue(config, init), { refreshing: true });
  }, [form, ...dep]);

  // Use useEffect so that we don't touch the form.init proxy during a render
  useEffect(() => {
    form.readOnly = readOnly;
  }, [form, readOnly]);

  return form;
}

/** Introspects the `init` prop to see if has a `map` function/etc. and returns the form value. */
function initValue<T>(config: ObjectConfig<T>, init: any): T {
  const initValue =
    init && "input" in init && "map" in init
      ? init.input
        ? init.map(init.input as any)
        : init.ifUndefined || {}
      : init || {};
  return pickFields(config, initValue) as T;
}

/**
 * Picks ony fields out of `instance` that are in the `formConfig`.
 *
 * This is useful for creating a form input from a GraphQL query result,
 * but ignoring extra data in the query that we don't want/need in the form.
 *
 * (Especially because the form.value will become our mutation's input type
 * that goes on the wire, we don't want superfluous data in it.)
 */
export function pickFields<T, I>(
  formConfig: ObjectConfig<T>,
  instance: I,
): { [K in keyof T]: K extends keyof I ? I[K] : never } {
  // If the caller is using classes, i.e. with their own custom observable behavior, then just use as-is
  if (!isPlainObject(instance)) {
    return instance as any;
  }
  return Object.fromEntries(
    Object.entries(formConfig).map(([key, _keyConfig]) => {
      const keyConfig = (_keyConfig as any) as
        | ObjectFieldConfig<any>
        | ListFieldConfig<any, any>
        | ValueFieldConfig<any, any>;
      const value = (instance as any)[key];
      if (keyConfig.type === "object") {
        if (value) {
          return [key, pickFields(keyConfig.config, value)];
        } else {
          return [key, value];
        }
      } else if (keyConfig.type === "list") {
        if (isObservable(value)) {
          // If we hit an observable array, leave it as the existing proxy so the our
          // ListFieldState will react to changes in the original array.
          return [key, value];
        } else if (value) {
          return [key, (value as any[]).map((u) => pickFields(keyConfig.config, u))];
        } else {
          return [key, value];
        }
      } else if (keyConfig.type === "value") {
        return [key, value];
      } else {
        return assertNever(keyConfig);
      }
    }),
  ) as any;
}
