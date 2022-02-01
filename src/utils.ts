import { isPlainObject } from "is-plain-object";
import { isObservable } from "mobx";
import { ListFieldConfig, ObjectConfig, ObjectFieldConfig, ValueFieldConfig } from "src/formState";

export function fail(message?: string): never {
  throw new Error(message || "Failed");
}

export function assertNever(x: never): never {
  throw new Error("Unexpected object: " + x);
}

/** Introspects the `init` prop to see if has a `map` function/etc. and returns the form value. */
export function initValue<T>(config: ObjectConfig<T>, init: any): T {
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
