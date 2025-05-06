import { isPlainObject } from "is-plain-object";
import { isObservable, toJS } from "mobx";
import { FragmentFieldConfig, ListFieldConfig, ObjectConfig, ObjectFieldConfig, ValueFieldConfig } from "src/config";
import { deepEquals } from "src/fields/deepEquals";
import { InputAndMap, QueryAndMap, UseFormStateOpts } from "src/useFormState";

export type Builtin = Date | Function | Uint8Array | string | number | boolean;

export type Primitive = undefined | null | boolean | string | number | Function | Date | { toJSON(): any };

/** Makes the keys in `T` required while keeping the values undefined. */
export type DeepRequired<T> = T extends Primitive
  ? T
  : {
      [P in keyof Required<T>]: T[P] extends Array<infer U>
        ? Array<DeepRequired<U>>
        : T[P] extends ReadonlyArray<infer U2>
          ? ReadonlyArray<DeepRequired<U2>>
          : DeepRequired<T[P]>;
    };

// Inverse of SubType: https://medium.com/dailyjs/typescript-create-a-condition-based-subset-types-9d902cea5b8c
export type OmitIf<Base, Condition> = Pick<
  Base,
  {
    [Key in keyof Base]: Base[Key] extends Condition ? never : Key;
  }[keyof Base]
>;

export function fail(message?: string): never {
  throw new Error(message || "Failed");
}

export function assertNever(x: never): never {
  throw new Error("Unexpected object: " + x);
}

/** Introspects the `init` prop to see if it has a `map` function/etc. and returns the form value. */
export function initValue<T>(config: ObjectConfig<T>, init: any): T {
  let value: any;
  if (isInput(init)) {
    value = init.input ? (init.map ? init.map(init.input) : init.input) : init.ifUndefined;
  } else if (isQuery(init)) {
    value = init.query.data ? init.map(init.query.data) : init.ifUndefined;
  } else if (init === undefined) {
    // allow completely undefined init
  } else {
    throw new Error("init must have an input or query key");
  }
  // Given our form config, pick out only the subset of fields out of `value` (unless it's a mobx class)
  return pickFields(config, value ?? {}) as T;
}

export function isInput<T, I>(init: UseFormStateOpts<T, I>["init"]): init is InputAndMap<T, I> {
  return !!init && typeof init === "object" && "input" in init;
}

export function isQuery<T, I>(init: UseFormStateOpts<T, I>["init"]): init is QueryAndMap<T, I> {
  return !!init && typeof init === "object" && "query" in init && "map" in init;
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
      const keyConfig = _keyConfig as any as
        | ObjectFieldConfig<any>
        | ListFieldConfig<any>
        | ValueFieldConfig<any>
        | FragmentFieldConfig;
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
      } else if (keyConfig.type === "fragment") {
        return [key, value];
      } else {
        return assertNever(keyConfig);
      }
    }),
  ) as any;
}

export function isNotUndefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function isEmpty(value: any): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * An equals that does deep-ish equality.
 *
 * We only do non-identity equals for:
 *
 * - "plain" objects that have no custom prototype/i.e. are object literals
 * - objects that implement `toJSON`
 * - arrays
 */
export function areEqual<T>(a?: T, b?: T, strictOrder?: boolean): boolean {
  if (isPlainObject(a)) {
    return deepEquals(toJS(a), toJS(b));
  }
  if (hasToJSON(a) || hasToJSON(b)) {
    const a1 = hasToJSON(a) ? a.toJSON() : a;
    const b1 = hasToJSON(b) ? b.toJSON() : b;
    return deepEquals(a1, b1);
  }
  if (a && b && a instanceof Array && b instanceof Array) {
    if (strictOrder !== false) {
      return deepEquals(a, b);
    }
    if (a.length !== b.length) return false;
    return a.every((a1) => b.some((b1) => areEqual(a1, b1)));
  }
  return a === b;
}

export function hasToJSON(o?: unknown): o is { toJSON(): void } {
  return !!(o && typeof o === "object" && "toJSON" in o);
}

/** Make a clone of `obj`, but only recurse into POJOs and Arrays...and stores. */
export function deepClone<T>(obj: T, map = new WeakMap()): T {
  if (obj && typeof obj === "object" && (isPlainObject(obj) || Array.isArray(obj) || isObservable(obj))) {
    if (map.has(obj)) return map.get(obj);
    const result = Array.isArray(obj) ? [] : {};
    map.set(obj, result);
    Object.assign(result, ...getAllPropertyNames(obj).map((key) => ({ [key]: deepClone((obj as any)[key], map) })));
    return result as T;
  } else {
    return obj;
  }
}

/** Returns all property names, including mobx computeds (non-enumerable) & inherited. */
function getAllPropertyNames(obj: unknown): string[] {
  const proto = Object.getPrototypeOf(obj);
  // Don't crawl up into Object.prototype, or into arrays/observable arrays
  const inherited = proto && proto !== Object.prototype && !Array.isArray(obj) ? getAllPropertyNames(proto) : [];
  return [...new Set(Object.getOwnPropertyNames(obj).concat(inherited))];
}
