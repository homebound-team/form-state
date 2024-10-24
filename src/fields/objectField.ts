import { computed, isObservable, makeAutoObservable, observable, reaction } from "mobx";
import { FragmentFieldConfig, ListFieldConfig, ObjectConfig, ObjectFieldConfig, ValueFieldConfig } from "src/config";
import { FragmentField, newFragmentField } from "src/fields/fragmentField";
import { ListFieldState, newListFieldState } from "src/fields/listField";
import { FieldState, FieldStateInternal, InternalSetOpts, SetOpts, newValueFieldState } from "src/fields/valueField";
import { Builtin, deepClone, fail } from "src/utils";

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
  isSameEntity(other: T): boolean;
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
  return newObjectState(
    { type: "object", config },
    undefined,
    undefined,
    undefined,
    instance,
    undefined,
    opts.maybeAutoSave || noop,
  );
}

/** A more internal version of `createObjectState`. */
export function newObjectState<T, P = any>(
  config: ObjectFieldConfig<T>,
  parentState: (() => ObjectState<P>) | undefined,
  parentInstance: P | undefined,
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

  // We directly mutate `instance` as the user edits the form, so keep a deep copy of the POJO.
  // If the user passed us `instance` that was a mobx store/class, this originalValue won't really
  // be a true match (i.e. pass instanceof), but it should be good enough
  const originalCopy: any = deepClone(instance);

  const objectConfig = config.config;
  const fieldStates = Object.entries(objectConfig).map(([_key, _config]) => {
    const key = _key as keyof T;
    const config = _config as
      | ValueFieldConfig<any>
      | ObjectFieldConfig<any>
      | ListFieldConfig<any>
      | FragmentFieldConfig;
    let field: FieldState<any> | ListFieldState<any> | ObjectState<T> | FragmentField<any>;
    if (config.type === "value") {
      field = newValueFieldState(
        originalCopy,
        instance,
        getObjectState,
        key,
        config.rules || [],
        config.isIdKey ||
          // Default the id key to "id" unless some other field has isIdKey set
          (key === "id" &&
            !(Object.entries(objectConfig) as any as [string, ValueFieldConfig<any>][]).some(
              ([other, c]) => other !== key && c.isIdKey,
            )),
        config.isDeleteKey || false,
        config.isReadOnlyKey || false,
        config.computed ??
          // If instance is a mobx class, we can detect computeds as they won't be enumerable
          (isObservable(instance) ? !(key in originalCopy) : false),
        config.readOnly ?? false,
        config.strictOrder ?? true,
        maybeAutoSave,
      );
    } else if (config.type === "list") {
      field = newListFieldState(
        originalCopy,
        instance,
        getObjectState,
        key,
        config.rules || [],
        config,
        { type: "object", config: config.config },
        config.strictOrder ?? true,
        maybeAutoSave,
      );
    } else if (config.type === "object") {
      if (!instance[key]) {
        instance[key] = {} as any;
      }
      field = newObjectState(
        config,
        getObjectState,
        instance,
        undefined,
        instance[key] as any,
        key,
        maybeAutoSave,
      ) as any;
    } else if (config.type === "fragment") {
      field = newFragmentField(instance, key);
    } else {
      throw new Error(`Invalid type value ${(config as any).type}`);
    }
    return [key, field];
  });

  // We always return the same `instance` field from our `value` method, but
  // we want to pretend that it's observable, so use a tick to force it.
  const _tick = observable({ value: 1 });

  const fieldNames = Object.keys(objectConfig);
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
    _kind: "object",
    _readOnly: false,
    _loading: false,
    _isAutoSaving: false,

    _considerDeleted(): boolean {
      const deleteField = getFields(this).find((f) => f._isDeleteKey);
      return !!deleteField?.value;
    },

    _considerReadOnly(): boolean {
      const readOnlyField = getFields(this).find((f) => f._isReadOnlyKey);
      return !!readOnlyField?.value;
    },

    get focused(): boolean {
      return getFields(this).some((f) => f.focused);
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
      return getFields(this).some((f) => f.dirty) || this.isUnset();
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
        throw new Error(`${String(key) || "formState"} is currently readOnly`);
      }
      // Restore our instance if we're being reset
      if (value && this.isUnset()) (parentInstance as any)[key] = instance;
      // Delete our instance if we're being unset
      if (!value && parentInstance) (parentInstance as any)[key] = undefined;
      // Otherwise just copy over the fields
      getFields(this).forEach((field) => {
        if (value && typeof value === "object" && field.key in value) {
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
      if (this._isAutoSaving) {
        // `commitChanges` will mark all WIP changes as committed, which might drop changes if there
        // is an auto-save in-flight, and the user made more changes, that are waiting for their turn
        // on the next auto-save request.
        //
        // Instead of doing a form-wide "all changes are committed", instead autosave forms should use
        // init.map/input to have the server's latest results updated within the form, which will then
        // selectively "un-dirty"/commit the just-saved data, but keep the "still-dirty" WIP data alone.
        throw new Error(
          "When using autoSave, you should not manually call commitChanges, instead have init.map/input update the form state",
        );
      }
      // asdf
      getFields(this).forEach((f) => f.commitChanges());
    },

    // Create a result that is only populated with changed keys
    get changedValue() {
      const result: any = {};
      // If we're a child, like `author.address` that was unset, return null
      if (this.isUnset()) {
        // If we're a reference, always return `{ id: ... }` for easy binding
        const idField = getFields(this).find((f) => f._isIdKey);
        if (idField && config.reference) return { id: null };
        // Otherwise mark the whole child as gone
        return null;
      }
      getFields(this).forEach((f) => {
        if ((f as any)._computed) return;
        // References only include the id key below
        if (config.reference) return;
        if (
          f.dirty ||
          // If the caller used useFormState.ifUndefined to provide some default values, then those keys may not
          // look dirty, but if we're new we should include them anyway.
          (this.isNewEntity && (f as any)._kind === "value" && f.value !== undefined) ||
          // ...or they're non-empty sub-objects
          (this.isNewEntity && (f as any)._kind === "object" && Object.entries(f.changedValue).length > 0) ||
          // ...or they're non-empty sub-lists
          (this.isNewEntity && (f as any)._kind === "list" && f.value?.length > 0)
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
      getFields(proxy).map((f) => f.originalValue);
      return originalCopy;
    },

    // An internal helper method to see if `other` is for "the same entity" as our current row
    isSameEntity(other: T): boolean {
      const idField = getFields(this).find((f) => f._isIdKey);
      if (!idField) return false;
      const ourIdValue = idField.value;
      const otherIdValue = (other as any)[idField.key];
      // If the otherIdValue is undefined, it's a new entity so can't be the same as us
      return otherIdValue !== undefined && otherIdValue === ourIdValue;
    },

    isUnset(): boolean {
      return !!parentInstance && (parentInstance as any)[key] === undefined;
    },
  };

  proxy = makeAutoObservable(obj, {
    // Use custom equality on `value` that is _never_ equals. This sounds weird, but
    // because our `value` is always the same `instance` that was passed to `newObjectState`,
    // to mobx this looks like the value never changes, and it will never invoke observers
    // even with our tick-based hacks.
    value: computed({ equals: () => false }),
    originalValue: computed({ equals: () => false }),
  });

  // Any time a field changes, percolate that change up to us
  reaction(
    () => getFields(proxy).map((f) => f.value),
    () => _tick.value++,
  );

  return proxy!;
}
