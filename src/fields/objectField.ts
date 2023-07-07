import { computed, makeAutoObservable, observable, reaction } from "mobx";
import { FragmentFieldConfig, ListFieldConfig, ObjectConfig, ObjectFieldConfig, ValueFieldConfig } from "src/config";
import { FragmentField, newFragmentField } from "src/fields/fragmentField";
import { ListFieldState, newListFieldState } from "src/fields/listField";
import { FieldState, FieldStateInternal, InternalSetOpts, newValueFieldState, SetOpts } from "src/fields/valueField";
import { Builtin, fail } from "src/utils";

/**
 * Wraps a given input/on-the-wire type `T` for editing in a form.
 *
 * We basically mimic every field in `T` (i.e. `firstName`, `lastName`, etc.) but decorate them
 * with form-specific state like `touched`, `dirty`, `errors`, etc.
 *
 * The intent is that, after ensuring all fields are `valid`/etc., callers can take the
 * result of this `objectState.value` (or `objectState.originalValue` for the non-proxy version) and
 * have exactly the on-the-wire type `T` that they need to submit to the backend, without doing the
 * manual mapping of "data that was in the form controls" into "data that the backend wants".
 *
 * Note that this can be hierarchical by having a field of `ListFieldState` that
 * themselves each wrap an `ObjectState`, i.e.:
 *
 * ```
 * ObjectState for author
 *   - firstName: FieldState
 *   - lastName: FieldState
 *   - rows: ListFieldState
 *     - [0]: ObjectState for book 1
 *       - title: FieldState
 *     - [1]: ObjectState for book 2
 *       - title: FieldState
 * ```
 */
export type ObjectState<T> =
  // Add state.field1, state.field2 for each key in T
  FieldStates<T> &
    // Pull in the touched, blur, dirty, etc
    FieldState<T> & {
      /** Sets the state of fields in `state`. */
      set(state: Partial<T>, opts?: SetOpts): void;

      /** Returns whether the object can be saved, i.e. is valid, but also as a side-effect marks touched. */
      canSave(): boolean;
    };

export type ObjectStateInternal<T> = ObjectState<T> & {
  set(value: T, opts?: InternalSetOpts): void;
};

const fragmentSym = Symbol("fragment");

export type Fragment<V> = V & { [fragmentSym]: true };

export function fragment<V>(value: V): Fragment<V> {
  return value as any;
}

/** For a given input type `T`, decorate each field into the "field state" type that holds our form-relevant state, i.e. valid/touched/etc. */
type FieldStates<T> = {
  [K in keyof T]-?: T[K] extends Fragment<infer V>
    ? FragmentField<V>
    : T[K] extends Array<infer U> | null | undefined
    ? [U] extends [Builtin]
      ? FieldState<T[K]>
      : ListFieldState<U>
    : T[K] extends Builtin | null | undefined
    ? FieldState<T[K]>
    : ObjectState<T[K]>;
};

/**
 * Creates a new `ObjectState` for a given form object `T` given config rules in `config`.
 *
 * The returned `ObjectState` can be used in a mobx `useLocalObservable` to drive an
 * interactive form that tracks the current valid/touched/etc. state of both each
 * individual fields as well as the top-level form/object itself.
 */
export function createObjectState<T>(
  config: ObjectConfig<T>,
  instance: T,
  opts: { maybeAutoSave?: () => void } = {},
): ObjectState<T> {
  const noop = () => {};
  return newObjectState(config, undefined, undefined, instance, undefined, opts.maybeAutoSave || noop);
}

export function newObjectState<T, P = any>(
  config: ObjectConfig<T>,
  parentState: (() => ObjectState<P>) | undefined,
  parentListState: FieldState<any> | undefined,
  instance: T,
  key: keyof T | undefined,
  maybeAutoSave: () => void,
): ObjectState<T> {
  // This is what we return, but we only know it's value until we call `observable`, so
  // we create a mutable variable to capture it so that we can create fields/call their
  // constructors and give them a way to access it later.
  let proxy: ObjectState<T> | undefined = undefined;
  function getObjectState(): ObjectState<T> {
    if (!proxy) {
      throw new Error("Race condition");
    }
    return proxy;
  }

  const objectConfig = config as ObjectConfig<T>;
  const fieldStates = Object.entries(config).map(([_key, _config]) => {
    const key = _key as keyof T;
    const config = _config as
      | ValueFieldConfig<T, any>
      | ObjectFieldConfig<any>
      | ListFieldConfig<T, any>
      | FragmentFieldConfig;
    let field: FieldState<any> | ListFieldState<any> | ObjectState<T> | FragmentField<any>;
    if (config.type === "value") {
      field = newValueFieldState(
        instance,
        getObjectState,
        key,
        config.rules || [],
        config.isIdKey ||
          // Default the id key to "id" unless some other field has isIdKey set
          (key === "id" &&
            !((Object.entries(objectConfig) as any) as [string, ValueFieldConfig<any, any>][]).some(
              ([other, c]) => other !== key && c.isIdKey,
            )),
        config.isDeleteKey || false,
        config.isReadOnlyKey || false,
        config.computed || false,
        config.readOnly || false,
        config.strictOrder ?? true,
        maybeAutoSave,
      );
    } else if (config.type === "list") {
      field = newListFieldState(
        instance,
        getObjectState,
        key,
        config.rules || [],
        config,
        config.config,
        config.strictOrder ?? true,
        maybeAutoSave,
      );
    } else if (config.type === "object") {
      if (!instance[key]) {
        instance[key] = {} as any;
      }
      field = newObjectState(config.config, getObjectState, undefined, instance[key] as any, key, maybeAutoSave) as any;
    } else if (config.type === "fragment") {
      field = newFragmentField(instance, key);
    } else {
      throw new Error("Unsupported");
    }
    return [key, field];
  });

  // We always return the same `instance` field from our `value` method, but
  // we want to pretend that it's observable, so use a tick to force it.
  const _tick = observable({ value: 1 });

  const fieldNames = Object.keys(config);
  function getFields(proxyThis: any): FieldStateInternal<T, any>[] {
    return fieldNames.map((name) => proxyThis[name]) as FieldStateInternal<T, any>[];
  }

  const obj = {
    ...Object.fromEntries(fieldStates),

    key,

    get value() {
      _tick.value > 0 || fail();
      return instance;
    },

    set value(value) {
      this.set(value);
    },

    // private
    _readOnly: false,
    _loading: false,

    _considerDeleted(): boolean {
      const deleteField = getFields(this).find((f) => f._isDeleteKey);
      return !!deleteField?.value;
    },

    _considerReadOnly(): boolean {
      const readOnlyField = getFields(this).find((f) => f._isReadOnlyKey);
      return !!readOnlyField?.value;
    },

    get touched(): boolean {
      return getFields(this).some((f) => f.touched);
    },

    set touched(touched: boolean) {
      getFields(this).forEach((f) => (f.touched = touched));
    },

    get readOnly(): boolean {
      return (
        this._readOnly ||
        this._considerReadOnly() ||
        (parentState && parentState().readOnly) ||
        !!parentListState?.readOnly
      );
    },

    set readOnly(readOnly: boolean) {
      this._readOnly = readOnly;
    },

    get loading(): boolean {
      return this._loading || (parentState && parentState().loading) || !!parentListState?.loading;
    },

    set loading(loading: boolean) {
      this._loading = loading;
    },

    get valid(): boolean {
      return getFields(this).every((f) => f.valid);
    },

    get errors(): string[] {
      return getFields(this).flatMap((f) => f.errors.map((e) => `${f.key}: ${e}`));
    },

    get dirty(): boolean {
      return getFields(this).some((f) => f.dirty);
    },

    get isNewEntity(): boolean {
      const idField = getFields(this).find((f) => f._isIdKey);
      // If we're a line item w/o an immediate id field, look in our parent
      if (!idField && parentState) {
        return parentState().isNewEntity;
      }
      // If there is no id field, assume we're not new
      return idField !== undefined && (idField.value === null || idField.value === undefined);
    },

    canSave(): boolean {
      this.touched = true;
      return this.valid;
    },

    // Accepts new values in bulk, i.e. when setting the form initial state from the backend.
    set(value: T, opts: InternalSetOpts = {}) {
      if (this.readOnly && !opts.resetting && !opts.refreshing) {
        throw new Error(`${key || "formState"} is currently readOnly`);
      }
      getFields(this).forEach((field) => {
        if (field.key in value) {
          field.set((value as any)[field.key], opts);
        }
      });
    },

    // Resets all fields back to their original values
    revertChanges() {
      getFields(this).forEach((f) => f.revertChanges());
    },

    // Saves all current values into _originalValue
    commitChanges() {
      getFields(this).forEach((f) => f.commitChanges());
    },

    // Create a result that is only populated with changed keys
    get changedValue() {
      const result: any = {};
      getFields(this).forEach((f) => {
        if (
          f.dirty ||
          // If the caller used useFormState.ifUndefined to provide some default values, then those keys may not
          // look dirty, but if we're new we should include them anyway.
          (this.isNewEntity &&
            // Unless they're undefined anyway
            f.value !== undefined &&
            // And unless they're empty sub-objects
            !(f.value instanceof Object && Object.entries(f.changedValue).length === 0))
        ) {
          result[f.key] = f.changedValue;
        }
      });
      // Ensure we always have the id for updates to work
      const idField = getFields(this).find((f) => f._isIdKey);
      if (idField && idField.value !== undefined) {
        result[idField.key] = idField.value;
      }
      return result;
    },

    get originalValue(): T | undefined {
      return instance;
    },

    // An internal helper method to see if `other` is for "the same entity" as our current row
    isSameEntity(other: T): boolean {
      const idField = getFields(this).find((f) => f._isIdKey);
      if (!idField) {
        return false;
      }
      return this[idField.key].value === (other as any)[idField.key];
    },
  };

  proxy = makeAutoObservable(obj, {
    // Use custom equality on `value` that is _never_ equals. This sounds weird, but
    // because our `value` is always the same `instance` that was passed to `newObjectState`,
    // to mobx this looks like the value never changes, and it will never invoke observers
    // even with our tick-based hacks.
    value: computed({ equals: () => false }),
  });

  // Any time a field changes, percolate that change up to us
  reaction(
    () => getFields(proxy).map((f) => f.value),
    () => _tick.value++,
  );

  return proxy!;
}
