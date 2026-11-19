import { computed, createAtom, type IAtom, isComputedProp, isObservable, makeAutoObservable } from "mobx";
import {
  type FragmentFieldConfig,
  type ListFieldConfig,
  type ObjectConfig,
  type ObjectFieldConfig,
  type ValueFieldConfig,
} from "src/config";
import { type FragmentField, newFragmentField } from "src/fields/fragmentField";
import { type ListFieldState, newListFieldState } from "src/fields/listField";
import { activateSubscriptions, deactivateSubscriptions, registerSubscriptions } from "src/fields/subscriptions";
import {
  type FieldState,
  type FieldStateInternal,
  type InternalSetOpts,
  newValueFieldState,
  type SetOpts,
} from "src/fields/valueField";
import { areEqual, type Builtin, deepClone, shallowEquals } from "src/utils";

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

export type ObjectStateInternal<T = unknown> = ObjectState<T> & {
  set(value: T, opts?: InternalSetOpts): void;
  isSameEntity(other: T): boolean;
  idKey: string | undefined;
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
  const form = createInactiveObjectState(config, instance, opts);
  activateSubscriptions(form);
  return form;
}

/** Builds a hook-owned form without subscriptions that could escape an abandoned render. */
export function createInactiveObjectState<T>(
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
    false,
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
  deepExhaustive: boolean,
): ObjectState<T> {
  const ObjectStateClass = getObjectStateClass(config.config);
  return new ObjectStateClass(
    config,
    parentState,
    parentInstance,
    parentListState,
    instance,
    key,
    maybeAutoSave,
    deepExhaustive,
  ) as any as ObjectState<T>;
}

/** The constructor of a config's ObjectState class, which takes the same arguments as `newObjectState`. */
type ObjectStateClass = new (
  config: ObjectFieldConfig<any>,
  parentState: (() => ObjectState<any>) | undefined,
  parentInstance: any,
  parentListState: FieldState<any> | undefined,
  instance: any,
  key: any,
  maybeAutoSave: () => void,
  deepExhaustive: boolean,
) => object;

// Weak, so that the class of a config that was not stable (i.e. created during a render) can be collected.
const objectStateClasses = new WeakMap<object, ObjectStateClass>();

/** Returns the ObjectState class for `objectConfig`, creating it the first time the config is used. */
function getObjectStateClass(objectConfig: ObjectConfig<any>): ObjectStateClass {
  let ObjectStateClass = objectStateClasses.get(objectConfig);
  if (!ObjectStateClass) {
    ObjectStateClass = createObjectStateClass(objectConfig);
    objectStateClasses.set(objectConfig, ObjectStateClass);
  }
  return ObjectStateClass;
}

/**
 * Creates the ObjectState class for one `objectConfig`, i.e. one class for all `authorConfig` forms.
 *
 * We make a class per config, instead of one class for all configs, because:
 *
 * - An ObjectState has a property per field in its config, i.e. `author.firstName`, and mobx's
 *   `makeAutoObservable` remembers the properties of the first instance of a class, and expects
 *   every later instance to have the same ones.
 * - What a config says about its fields, i.e. which one is the id key, is the same for every
 *   form, so we work it out once here, instead of searching the fields on each read.
 * - Like `ValueFieldState`, the methods are on a prototype, so mobx wraps each as an action once
 *   per config, instead of once per form (or per row in a list or table).
 *
 * I.e. for `authorConfig = { id: f.value(), firstName: f.value(), books: f.list(...) }`, we have
 * `fieldNames = ["id", "firstName", "books"]` and `idFieldName = "id"`, and each instance gets its
 * own `id`, `firstName`, and `books` child fields.
 */
function createObjectStateClass<T>(objectConfig: ObjectConfig<T>): ObjectStateClass {
  type FieldConfig = ValueFieldConfig<any> | ObjectFieldConfig<any> | ListFieldConfig<any> | FragmentFieldConfig;
  const fieldConfigs = Object.entries(objectConfig) as [string, FieldConfig][];
  const fieldNames = fieldConfigs.map(([name]) => name);

  // The first value field with each of these flags is the one that the object-level checks use
  const idFieldName = fieldConfigs.find(([name, config]) => isIdKey(fieldConfigs, name, config))?.[0];
  const deleteFieldName = fieldConfigs.find(([, config]) => config.type === "value" && config.isDeleteKey)?.[0];
  const readOnlyFieldName = fieldConfigs.find(([, config]) => config.type === "value" && config.isReadOnlyKey)?.[0];

  const annotations = {
    // Skip mobx tracking for our child fields: each is already observable, and is never replaced
    ...Object.fromEntries(fieldNames.map((name) => [name, false])),
    // Same for constants, private members, and `_isAutoSaving`, which no observer reads
    key: false,
    _kind: false,
    _isAutoSaving: false,
    _config: false,
    _parentState: false,
    _parentInstance: false,
    _parentListState: false,
    _instance: false,
    _originalCopy: false,
    _unsetAtom: false,
    _deepExhaustive: false,
    _fields: false,
    // Not a computed, so that our value fields see every read, see `ValueFieldState.changedValue`
    changedValue: false,
    // Use custom equality on `value` that is _never_ equals. This sounds weird, but
    // because our `value` is always the same `instance` that was passed to `newObjectState`,
    // to mobx this looks like the value never changes, and it will never invoke observers
    // even with our tick-based hacks.
    value: computed({ equals: () => false }),
    originalValue: computed({ equals: () => false }),
    // We return a new array each time, so only tell observers when the messages change
    errors: computed<string[]>({ equals: shallowEquals }),
  };

  return class ObjectStateImpl {
    readonly key: keyof T | undefined;

    // private
    readonly _kind = "object";
    _readOnly = false;
    _loading = false;
    _isAutoSaving = false;

    private readonly _config: ObjectFieldConfig<T>;
    private readonly _parentState: (() => ObjectState<any>) | undefined;
    private readonly _parentInstance: any;
    private readonly _parentListState: FieldState<any> | undefined;
    private readonly _instance: T;
    // We directly mutate `instance` as the user edits the form, so keep a deep copy of the POJO.
    // If the user passed us `instance` that was a mobx store/class, this originalValue won't really
    // be a true match (i.e. pass instanceof), but it should be good enough
    private readonly _originalCopy: any;
    // `parentInstance[key]` is not a proxy, so we use an atom as our "this child object was
    // unset/restored" trigger: `isUnset` calls `reportObserved`, `set` calls `reportChanged`.
    private readonly _unsetAtom: IAtom;
    private readonly _deepExhaustive: boolean;
    /** Our child fields, in `fieldNames` order; each is also a property, i.e. `this.firstName`. */
    private readonly _fields: FieldStateInternal<T, any>[];

    constructor(
      config: ObjectFieldConfig<T>,
      parentState: (() => ObjectState<any>) | undefined,
      parentInstance: any,
      parentListState: FieldState<any> | undefined,
      instance: T,
      key: keyof T | undefined,
      maybeAutoSave: () => void,
      deepExhaustive: boolean,
    ) {
      this.key = key;
      this._config = config;
      this._parentState = parentState;
      this._parentInstance = parentInstance;
      this._parentListState = parentListState;
      this._instance = instance;
      this._originalCopy = deepClone(instance);
      this._unsetAtom = createAtom(`${String(key)}.unset`);
      this._deepExhaustive = deepExhaustive;

      // Our child fields ask for us lazily, so they can be created before we are observable
      const getObjectState = () => this as any as ObjectState<T>;
      this._fields = fieldConfigs.map(([name, fieldConfig]) => {
        const field = newChildField(
          fieldConfigs,
          name as keyof T,
          fieldConfig,
          this._originalCopy,
          instance,
          getObjectState,
          maybeAutoSave,
          deepExhaustive,
        );
        (this as any)[name] = field;
        return field as FieldStateInternal<T, any>;
      });

      makeAutoObservable(this, annotations as any);

      registerSubscriptions(this, {
        activate: () => this._fields.forEach((field) => activateSubscriptions(field)),
        deactivate: () => this._fields.forEach((field) => deactivateSubscriptions(field)),
      });
    }

    get value() {
      // We always return the same `instance`, so read each field's value here to make
      // observers of our (identity-stable) `value` re-run when any field deeply changes.
      // (`originalValue` below does the same for `originalCopy`.)
      this._fields.forEach((f) => f.value);
      // A child object can be removed from its parent, i.e. `author.address.set(undefined)` writes
      // `address = undefined` into the author. That changes what the author's `value` holds, but
      // none of the address's own fields, so observe it here.
      this._unsetAtom.reportObserved();
      return this._instance;
    }

    set value(value) {
      this.set(value);
    }

    _considerDeleted(): boolean {
      return !!this.fieldNamed(deleteFieldName)?.value;
    }

    _considerReadOnly(): boolean {
      return !!this.fieldNamed(readOnlyFieldName)?.value;
    }

    get focused(): boolean {
      return this._fields.some((f) => f.focused);
    }

    get touched(): boolean {
      return this._fields.some((f) => f.touched);
    }

    set touched(touched: boolean) {
      this._fields.forEach((f) => (f.touched = touched));
    }

    get readOnly(): boolean {
      return (
        this._readOnly ||
        this._considerReadOnly() ||
        (this._parentState && this._parentState().readOnly) ||
        !!this._parentListState?.readOnly
      );
    }

    set readOnly(readOnly: boolean) {
      this._readOnly = readOnly;
    }

    get loading(): boolean {
      return this._loading || (this._parentState && this._parentState().loading) || !!this._parentListState?.loading;
    }

    set loading(loading: boolean) {
      this._loading = loading;
    }

    get valid(): boolean {
      return this._fields.every((f) => {
        return f.valid;
      });
    }

    get errors(): string[] {
      return this._fields.flatMap((f) => f.errors.map((e) => `${f.key}: ${e}`));
    }

    get dirty(): boolean {
      return (
        this._fields.some((f) => f.dirty && !(f as FieldStateInternal<any, any>)._isLocalOnly) ||
        // `isUnset` checks if our `parent[key] === undefined`, which can mean "surely we're dirty",
        // but as long as we've got some keys actually set
        (this.isUnset() && !areEqual<unknown>(this.value, {}))
      );
    }

    get isNewEntity(): boolean {
      const idField = this.fieldNamed(idFieldName);
      // If we're a line item w/o an immediate id field, look in our parent
      if (!idField && this._parentState) {
        return this._parentState().isNewEntity;
      }
      // If there is no id field, assume we're not new
      return idField !== undefined && (idField.value === null || idField.value === undefined);
    }

    /** Returns whether the object can be saved, i.e. is valid, but also as a side-effect marks touched. */
    canSave(): boolean {
      this.touched = true;
      return this.valid;
    }

    // Accepts new values in bulk, i.e. when setting the form initial state from the backend.
    set(value: T, opts: InternalSetOpts = {}) {
      const key = this.key;
      if (this.readOnly && !opts.resetting && !opts.refreshing) {
        throw new Error(`${String(key) || "formState"} is currently readOnly`);
      }
      // Restore our instance if we're being reset
      if (value && this.isUnset()) {
        this._parentInstance[key] = this._instance;
        this._unsetAtom.reportChanged();
      }
      // Delete our instance if we're being unset
      if (!value && this._parentInstance && !this.isUnset()) {
        this._parentInstance[key] = undefined;
        this._unsetAtom.reportChanged();
      }
      // Otherwise just copy over the fields
      this._fields.forEach((field) => {
        if (value && typeof value === "object" && field.key in value) {
          field.set((value as any)[field.key], opts);
        }
      });
    }

    // Resets all fields back to their original values
    revertChanges() {
      this._fields.forEach((f) => f.revertChanges());
    }

    // Saves all current values into _originalValue.
    // Deprecated: use formState.update(ackedServerValue) so saved changes are audited field-by-field.
    commitChanges() {
      if (this._isAutoSaving) {
        // `commitChanges` will mark all WIP changes as committed, which might drop changes if there
        // is an auto-save in-flight, and the user made more changes, that are waiting for their turn
        // on the next auto-save request.
        //
        // Instead of doing a form-wide "all changes are committed", autosave forms should use
        // formState.update(ackedServerValue), or init.map/input, to apply the server's latest results
        // within the form. That selectively "un-dirty"/commits the just-saved data, but keeps the
        // "still-dirty" WIP data alone.
        throw new Error(
          "When using autoSave, you should not manually call commitChanges, instead have init.map/input update the form state",
        );
      }
      this._fields.forEach((f) => f.commitChanges());
    }

    // Create a result that is only populated with changed keys
    get changedValue() {
      const result: any = {};
      const idField = this.fieldNamed(idFieldName);
      // If we're a child, like `author.address` that was unset, return null
      if (this.isUnset()) {
        // If we're a reference, always return `{ id: ... }` for easy binding
        if (idField && this._config.reference) return { id: null };
        // Otherwise mark the whole child as gone
        return null;
      }
      this._fields.forEach((f) => {
        if ((f as any)._computed) return;
        // References only include the id key below
        if (this._config.reference) return;
        // Ignore local-only fields
        if (f._isLocalOnly) return;
        if (
          f.dirty ||
          // If the caller used useFormState.ifUndefined to provide some default values, then those keys may not
          // look dirty, but if we're new we should include them anyway.
          (this.isNewEntity && (f as any)._kind === "value" && f.value !== undefined) ||
          // ...or they're non-empty sub-objects
          (this.isNewEntity &&
            (f as any)._kind === "object" &&
            // Child objects that are unset will have `changedValue = null`
            f.changedValue &&
            Object.entries(f.changedValue).length > 0) ||
          // ...or they're non-empty sub-lists
          (this.isNewEntity && (f as any)._kind === "list" && f.value?.length > 0) ||
          // ...or the parent list is deep-exhaustive
          this._deepExhaustive
        ) {
          result[f.key] = f.changedValue;
        }
      });
      // Ensure we always have the id for updates to work
      if (idField && idField.value !== undefined) {
        result[idField.key] = idField.value;
      }
      return result;
    }

    /** Releases any mobx reactions our fields created. */
    dispose() {
      deactivateSubscriptions(this);
    }

    get originalValue(): T | undefined {
      this._fields.forEach((f) => f.originalValue);
      return this._originalCopy;
    }

    // An internal helper method to see if `other` is for "the same entity" as our current row
    isSameEntity(other: T): boolean {
      const idField = this.fieldNamed(idFieldName);
      if (!idField) return false;
      const ourIdValue = idField.value;
      const otherIdValue = (other as any)[idField.key];
      // If the otherIdValue is undefined, it's a new entity so can't be the same as us
      return otherIdValue !== undefined && areEqual(otherIdValue, ourIdValue);
    }

    /** Returns whether we are a child object that was removed from its parent, i.e. `author.address`. */
    isUnset(): boolean {
      this._unsetAtom.reportObserved();
      return !!this._parentInstance && this._parentInstance[this.key] === undefined;
    }

    get idKey(): string | undefined {
      return idFieldName;
    }

    /** Returns our child field for one of the config's special keys, i.e. `idFieldName`, if it has one. */
    private fieldNamed(name: string | undefined): FieldStateInternal<T, any> | undefined {
      return name === undefined ? undefined : (this as any)[name];
    }
  };
}

/** Creates the child field for `key`, i.e. a value, list, object, or fragment field. */
function newChildField<T>(
  fieldConfigs: [string, ValueFieldConfig<any> | ObjectFieldConfig<any> | ListFieldConfig<any> | FragmentFieldConfig][],
  key: keyof T,
  config: ValueFieldConfig<any> | ObjectFieldConfig<any> | ListFieldConfig<any> | FragmentFieldConfig,
  originalCopy: any,
  instance: T,
  getObjectState: () => ObjectState<T>,
  maybeAutoSave: () => void,
  deepExhaustive: boolean,
): FieldState<any> | ListFieldState<any> | ObjectState<T> | FragmentField<any> {
  if (config.type === "value") {
    return newValueFieldState(
      originalCopy,
      instance,
      getObjectState,
      key,
      config.rules || [],
      isIdKey(fieldConfigs, key as string, config),
      config.isDeleteKey || false,
      config.isReadOnlyKey || false,
      config.isLocalOnly || false,
      config.computed ??
        // If instance is a mobx class, we can detect its computeds. We ask mobx, instead of looking
        // for keys missing from `originalCopy`, because `deepClone` also copies getters.
        (isObservable(instance) && isComputedProp(instance, key as string)),
      config.readOnly ?? false,
      config.strictOrder ?? true,
      maybeAutoSave,
    );
  } else if (config.type === "list") {
    return newListFieldState(
      originalCopy,
      instance,
      getObjectState,
      key,
      config.rules || [],
      config,
      { type: "object", config: config.config },
      config.strictOrder ?? true,
      maybeAutoSave,
      deepExhaustive,
    );
  } else if (config.type === "object") {
    // Because our objectField will fundamentally want to do `child.firstName.set(...)` or
    // even `child.firstName !== undefined`, etc., we "simplify" things by always setting
    // an empty object, for our child valueFields/listFields to use/read from, although
    // we then have to "oh right ignore {}" in places like `dirty`.
    if (!instance[key]) {
      instance[key] = {} as any;
    }
    return newObjectState(
      config,
      getObjectState,
      instance,
      undefined,
      instance[key] as any,
      key,
      maybeAutoSave,
      deepExhaustive,
    ) as any;
  } else if (config.type === "fragment") {
    return newFragmentField(instance as object & T, key as any);
  } else {
    throw new Error(`Invalid type value ${(config as any).type}`);
  }
}

/** Returns whether the `name` field is its object's id key, either by config or by being named `id`. */
function isIdKey(
  fieldConfigs: [string, ValueFieldConfig<any> | ObjectFieldConfig<any> | ListFieldConfig<any> | FragmentFieldConfig][],
  name: string,
  config: ValueFieldConfig<any> | ObjectFieldConfig<any> | ListFieldConfig<any> | FragmentFieldConfig,
): boolean {
  if (config.type !== "value") return false;
  return (
    config.isIdKey ||
    // Default the id key to "id" unless some other field has isIdKey set
    (name === "id" &&
      !("isIdKey" in config) && // Allow setting `isIdKey=false`
      !(fieldConfigs as any as [string, ValueFieldConfig<any>][]).some(([other, c]) => other !== name && c.isIdKey))
  );
}
