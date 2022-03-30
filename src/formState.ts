import equal from "fast-deep-equal";
import { isPlainObject } from "is-plain-object";
import { action, computed, makeAutoObservable, observable, reaction, toJS } from "mobx";
import { fail } from "src/utils";

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
 * Note that this can be hierarchical by having by having a field of `ListFieldState` that
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
// TODO Maybe rename to FormObjectState or ObjectFieldState
export type ObjectState<T, P = any> =
  // Add state.field1, state.field2 for each key in T
  FieldStates<T> &
    // Pull in the touched, blur, dirty, etc
    FieldState<P, T> & {
      /** Sets the state of fields in `state`. */
      set(state: Partial<T>, opts?: SetOpts): void;

      /** Returns whether the object can be saved, i.e. is valid, but also as a side-effect marks touched. */
      canSave(): boolean;
    };

export type Builtin = Date | Function | Uint8Array | string | number | boolean;

/** For a given input type `T`, decorate each field into the "field state" type that holds our form-relevant state, i.e. valid/touched/etc. */
type FieldStates<T> = {
  [K in keyof T]-?: T[K] extends Array<infer U> | null | undefined
    ? [U] extends [Builtin]
      ? FieldState<T, T[K]>
      : ListFieldState<T, U>
    : T[K] extends Builtin | null | undefined
    ? FieldState<T, T[K]>
    : ObjectState<T[K], T>;
};

// https://stackoverflow.com/questions/55541275/typescript-check-for-the-any-type
type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;

/** A validation rule, given the value and name, return the error string if valid, or undefined if valid. */
export type Rule<T, V> = (opts: {
  value: V;
  key: string;
  originalValue: V;
  // We need to pass `object` as the ObjectState, so that the rule is registered as an observer.
  // (The `IfAny` is because the `-?` in `FieldStates breaks the `any` type, see the "weirdness" test.)
  object: IfAny<T, any, ObjectState<T>>;
}) => string | undefined;

/** A rule that validates `value` is not `undefined`, `null`, or empty string. */
// We pre-emptively make this a mobx action so that it's identity doesn't change when proxy-ified
// and breaks our ability to do `rules.some(r => r === required)`.
export const required = action(<V>({ value: v }: { value: V }): string | undefined => {
  const isEmptyString = typeof v === "string" ? v.trim() === "" : false;
  return v !== undefined && v !== null && !isEmptyString ? undefined : "Required";
});

/**
 * Form state for a primitive field in the form, i.e. its value but also touched/validation/etc. state.
 *
 * This API also provides hooks for form elements to call into, i.e. `blur()` and `set(...)` that will
 * update the field state and re-render, i.e. when including in an `ObjectState`-typed literal that is
 * an mobx `useLocalObservable`/observable.
 *
 * Note that `V` will always have `null | undefined` added to it by `FieldStates`, b/c most form fields
 * i.e. text boxes, can always be cleared out/deleted.
 */
export interface FieldState<T, V> {
  readonly key: string;
  value: V;
  readonly originalValue: V;
  touched: boolean;
  readOnly: boolean;
  readonly required: boolean;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly isNewEntity: boolean;
  rules: Rule<T, V>[];
  readonly errors: string[];
  /** Returns a subset of V with only the changed values. Currently not observable. */
  readonly changedValue: V;
  /** Focuses the field. Disables changes from `ObjectState.set` calls. */
  focus(): void;
  /** Blur marks the field as touched and triggers an auto-save. */
  blur(): void;
  /** Triggers an auto-save; the caller (i.e. useFormState) should still dirty & valid check. */
  maybeAutoSave(): void;
  set(value: V, opts?: SetOpts): void;
  /** Reverts back to the original value and resets dirty/touched. */
  reset(): void;
  /** Accepts the current changed value (if any) as the original and resets dirty/touched. */
  save(): void;
}

/** Public options for our `set` command. */
export interface SetOpts {
  /** Whether this `set` should trigger an auto-save; defaults to true. */
  autoSave?: boolean;
}

/** Internal `.set` opts for conditionally that form-state internally percolates. */
interface InternalSetOpts extends SetOpts {
  /** `resetting` is the code calling `.reset()` to revert to original values. */
  resetting?: boolean;
  /** `refreshing` is when `useFormState` sees a new value. */
  refreshing?: boolean;
}

export interface FieldStateInternal<T, V> extends FieldState<T, V> {
  set(value: V, opts?: InternalSetOpts): void;
  _isIdKey: boolean;
  _isDeleteKey: boolean;
  _isReadOnlyKey: boolean;
  _focused: boolean;
}

export type ObjectStateInternal<T, P = any> = ObjectState<T, P> & {
  set(value: P, opts?: InternalSetOpts): void;
};

/** Form state for list of children, i.e. `U` is a `Book` in a form with a `books: Book[]`. */
export interface ListFieldState<T, U> extends Omit<FieldState<T, U[]>, "originalValue"> {
  readonly rows: ReadonlyArray<ObjectState<U>>;

  add(value: U, index?: number): void;

  remove(indexOrValue: number | U): void;
}

/**
 * Config rules for each field in `T` that we're editing in a form.
 *
 * Basically every field is either a value/primitive or a list, and this `ObjectConfig` lets
 * the caller define field-specific behavior, i.e. validation rules.
 */
export type ObjectConfig<T> = {
  // Right now ObjectState assumes every field (except functions) in T exists in the config
  // object, so this `keyof T` cannot be optional, i.e. we require a config for every field
  // on T. If we want to loosen this, then ObjectState needs to accept a generic that
  // is our config.
  //
  // We ignore functions (the OmitIf) to support observable classes that have
  // helper methods, i.e. `.toInput()`.
  [P in keyof OmitIf<T, Function>]: T[P] extends Array<infer U> | null | undefined
    ? U extends Builtin
      ? ValueFieldConfig<T, T[P]>
      : ListFieldConfig<T, U>
    : ValueFieldConfig<T, T[P]> | ObjectFieldConfig<T[P]>;
};

// Inverse of SubType: https://medium.com/dailyjs/typescript-create-a-condition-based-subset-types-9d902cea5b8c
type OmitIf<Base, Condition> = Pick<
  Base,
  {
    [Key in keyof Base]: Base[Key] extends Condition ? never : Key;
  }[keyof Base]
>;

/** Field configuration for primitive values, i.e. strings/numbers/Dates/user-defined types. */
export type ValueFieldConfig<T, V> = {
  type: "value";
  rules?: Rule<T, V | null | undefined>[];
  /**
   * If true, marks this field as the id, which will be used for things like "always include in changedValue".
   *
   * Defaults to true for fields named `id`.
   */
  isIdKey?: boolean;
  /** If true, and this value is used on an entity in a list, the entity won't count towards the list validity. */
  isDeleteKey?: boolean;
  /** If true, the entity that contains this value will be treated as read only. */
  isReadOnlyKey?: boolean;
  /**
   * Marks a field as being backed by a mobx class computed field.
   *
   * Note that it might still be settable (some computed have setters), but we do
   * exclude from the `reset` operation, i.e. we assume resetting other non-computed fields
   * will effectively reset this field as well.
   */
  computed?: boolean;
  /** Marks a field as being initiallyread-only, i.e. `field.readOnly = true/false` can change this default. */
  readOnly?: boolean;
};

/** Field configuration for list values, i.e. `U` is `Book` in a form with `books: Book[]`. */
export type ListFieldConfig<T, U> = {
  type: "list";
  /** Rules that can run on the full list of children. */
  rules?: Rule<T, readonly ObjectState<U>[]>[];
  /** Config for each child's form state, i.e. each book. */
  config: ObjectConfig<U>;
  /**
   * What the server-side update behavior is for this collection.
   *
   * When exhaustive, we include all rows in `changedValue` so that we
   * don't orhan unchanged rows.
   *
   * When incremental, we only include changed rows in `changedValue`.
   *
   * Defaults to `exhaustive` b/c that is the safest and also Joist's
   * default behavior.
   */
  update?: "exhaustive" | "incremental";
};

export type ObjectFieldConfig<U> = {
  type: "object";
  /** Config for the child's form state, i.e. each book. */
  config: ObjectConfig<U>;
};

/**
 * Creates a new `ObjectState` for a given form object `T` given config rules in `config`.
 *
 * The returned `ObjectState` can be used in a mobx `useLocalObservable` to driven an
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

function newObjectState<T, P = any>(
  config: ObjectConfig<T>,
  parentState: (() => ObjectState<P>) | undefined,
  parentListState: FieldState<any, any> | undefined,
  instance: T,
  key: keyof T | undefined,
  maybeAutoSave: () => void,
): ObjectState<T, P> {
  // This is what we return, but we only know it's value until we call `observable`, so
  // we create a mutable variable to capture it so that we can create fields/call their
  // constructors and give them a way to access it later.
  let proxy: ObjectState<T, P> | undefined = undefined;
  function getObjectState(): ObjectState<T, P> {
    if (!proxy) {
      throw new Error("Race condition");
    }
    return proxy;
  }

  const fieldStates = Object.entries(config).map(([_key, _config]) => {
    const key = _key as keyof T;
    const config = _config as ValueFieldConfig<T, any> | ObjectFieldConfig<any> | ListFieldConfig<T, any>;
    let field: FieldState<T, any> | ListFieldState<T, any> | ObjectState<T, P>;
    if (config.type === "value") {
      field = newValueFieldState(
        instance,
        getObjectState,
        key,
        config.rules || [],
        config.isIdKey || key === "id",
        config.isDeleteKey || false,
        config.isReadOnlyKey || false,
        config.computed || false,
        config.readOnly || false,
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
        maybeAutoSave,
      );
    } else if (config.type === "object") {
      if (!instance[key]) {
        instance[key] = {} as any;
      }
      field = newObjectState(config.config, getObjectState, undefined, instance[key] as any, key, maybeAutoSave) as any;
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
    reset() {
      getFields(this).forEach((f) => f.reset());
    },

    // Saves all current values into _originalValue
    save() {
      getFields(this).forEach((f) => f.save());
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

function newValueFieldState<T, K extends keyof T>(
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<T, T[K] | null | undefined>[],
  isIdKey: boolean,
  isDeleteKey: boolean,
  isReadOnlyKey: boolean,
  computed: boolean,
  readOnly: boolean,
  maybeAutoSave: () => void,
): FieldState<T, T[K] | null | undefined> {
  type V = T[K];

  // keep a copy here for reference equality
  const value = parentInstance[key] as V;
  let _originalValue: V | null | undefined = value === null ? undefined : isPlainObject(value) ? toJS(value) : value;

  // Because we read/write the value directly back into parentInstance[key],
  // which itself is not a proxy, we use this as our "value changed" trigger.
  const _tick = observable({ value: 1 });
  const _originalValueTick = observable({ value: 1 });

  const field = {
    key,

    touched: false,

    /** Current readOnly value. */
    _readOnly: readOnly || false,

    _focused: false,

    _isIdKey: isIdKey,
    _isDeleteKey: isDeleteKey,
    _isReadOnlyKey: isReadOnlyKey,

    rules,

    get value(): V {
      const value = _tick.value > 0 ? parentInstance[key] : fail();
      // Re-create the `keepNull` logic on sets but for our initial read where our
      // originalValue is null (empty) but we want to expose it as undefined for
      // consistency of "empty-ness" to our UI components.
      return value === null && isEmpty(_originalValue) ? (undefined as any) : value;
    },

    set value(v: V) {
      this.set(v);
    },

    get dirty(): boolean {
      return !areEqual(this.originalValue, this.value);
    },

    /** Returns whether this field is readOnly, although if our parent is readOnly then it trumps. */
    get readOnly(): boolean {
      return parentState().readOnly || this._readOnly;
    },

    /** Sets the field readOnly, but `v` will still be or-d with the parent's readOnly state. */
    set readOnly(v: boolean) {
      this._readOnly = v;
    },

    // For primitive fields, the changed value is just the value.
    get changedValue() {
      return this.value;
    },

    get valid(): boolean {
      const opts = { value: this.value, key: key as string, originalValue: this.originalValue, object: parentState() };
      return this.rules.every((r) => r(opts as any) === undefined);
    },

    get errors(): string[] {
      const opts = { value: this.value, key: key as string, originalValue: this.originalValue, object: parentState() };
      return this.rules.map((r) => r(opts as any)).filter(isNotUndefined);
    },

    get required(): boolean {
      return this.rules.some((rule) => rule === required);
    },

    get isNewEntity(): boolean {
      return parentState().isNewEntity;
    },

    focus() {
      this._focused = true;
    },

    blur() {
      this.maybeAutoSave();
      this._focused = false;
    },

    maybeAutoSave() {
      // Now that the user is done editing the field (note maybe w/o blurring, i.e. if they hit enter), we sneak in some trim logic
      this.maybeTrim();

      // touched is readonly, but we're allowed to change it
      this.touched = true;
      maybeAutoSave();
    },

    set(value: V | null | undefined, opts: InternalSetOpts = {}) {
      if (this.readOnly && !opts.resetting && !opts.refreshing) {
        throw new Error(`${key} is currently readOnly`);
      }

      if (opts.refreshing && this.dirty && this.value !== value) {
        // Ignore incoming values if we have changes (this.dirty) unless our latest change (this.value)
        // matches the incoming value (value), b/c if it does we should accept it and reset originalValue
        // so that we're not longer dirty.
        return;
      } else if (computed && (opts.resetting || opts.refreshing)) {
        // Computeds can't be either reset or refreshed
        return;
      }

      // If the user has deleted/emptied a value that was originally set, keep it as `null`
      // so that our partial update to the backend correctly unsets it.
      const keepNull = !isEmpty(this.originalValue) && isEmpty(value);
      // If a list of primitives was originally undefined, coerce `[]` to `undefined`
      const coerceEmptyList = value && value instanceof Array && value.length === 0 && isEmpty(this.originalValue);
      const newValue = keepNull ? null : isEmpty(value) || coerceEmptyList ? undefined : value;

      // Set the value on our parent object
      const changed = !areEqual(newValue, this.value);
      parentInstance[key] = newValue!;
      _tick.value++;

      if (opts.refreshing) {
        this.originalValue = newValue;
      }
      // If we're being set programmatically, i.e. we don't currently have focus,
      // call blur to trigger any auto-saves.
      if (!this._focused && !opts.refreshing && !opts.resetting && this.dirty && changed && opts.autoSave !== false) {
        this.maybeAutoSave();
      }
    },

    reset() {
      if (!computed) {
        this.set(this.originalValue, { resetting: true });
      }
      this.touched = false;
    },

    save() {
      if (isPlainObject(this.originalValue)) {
        this.originalValue = toJS(this.value);
      } else {
        this.originalValue = this.value;
      }
      this.touched = false;
    },

    get originalValue(): V | null | undefined {
      // A dummy check to for reactivity around our non-proxy value
      return _originalValueTick.value > -1 ? _originalValue : _originalValue;
    },

    set originalValue(v: V | null | undefined) {
      _originalValue = v;
      _originalValueTick.value++;
    },

    maybeTrim() {
      if (typeof this.value === "string") {
        let newValue: string | undefined = this.value.trim();
        if (newValue === "") {
          newValue = undefined;
        }
        if (newValue !== this.value) {
          this.set(newValue as any);
        }
      }
    },
  };

  return field as any;
}

function newListFieldState<T, K extends keyof T, U>(
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<T, readonly ObjectState<U>[]>[],
  listConfig: ListFieldConfig<T, U>,
  config: ObjectConfig<U>,
  maybeAutoSave: () => void,
): ListFieldState<T, U> {
  // Keep a map of "item in the parent list" -> "that item's ObjectState"
  const rowMap = new Map<U, ObjectStateInternal<U>>();
  const _tick = observable({ value: 1 });

  // this is for dirty checking, not object identity
  let originalCopy = [...((parentInstance[key] as any) || [])];

  const list = {
    key: key as string,

    // Our fundamental state of wrapped Us
    get value() {
      return _tick.value > 0 ? ((parentInstance[key] as any) as U[]) : fail();
    },

    _focused: false,
    _readOnly: false,

    get readOnly(): boolean {
      return this._readOnly || parentState().readOnly;
    },

    set readOnly(readOnly: boolean) {
      this._readOnly = readOnly;
    },

    set value(v: U[]) {
      this.set(v);
    },

    get dirty(): boolean {
      return this.rows.some((r) => r.dirty) || this.hasNewItems();
    },

    get required(): boolean {
      return this.rules.some((rule) => rule === required);
    },

    get isNewEntity(): boolean {
      return parentState().isNewEntity;
    },

    // private
    hasNewItems(): boolean {
      const [current, original] = [this.value || [], originalCopy || []];
      // Instead of relying on just object identities, we look up each child's state
      // in rowMap, because we already dedup/check object identity (i.e. look for id fields)
      // when create object states.
      const a = current.every((e: any) => {
        const state = rowMap.get(e);
        return original.some((e) => rowMap.get(e) === state);
      });
      const b = original.every((e: any) => {
        const state = rowMap.get(e);
        return current.some((e) => rowMap.get(e) === state);
      });
      const isSame = a && b;
      return !isSame;
    },

    // And we can derive each value's ObjectState wrapper as needed from the rowMap cache
    get rows(): readonly ObjectState<U>[] {
      // It's unclear why we need to access _tick.value here, b/c calling `this.value` should
      // transitively register us as a dependency on it
      if (_tick.value < 0) fail();
      return (this.value || []).map((child) => {
        // Because we're reading from this.value, child will be the proxy version
        let childState = rowMap.get(child);
        if (!childState) {
          childState = newObjectState<U>(
            config,
            parentState,
            (list as any) as FieldState<any, any>,
            child,
            undefined,
            maybeAutoSave,
          );
          rowMap.set(child, childState);
        }
        return childState;
      });
    },

    // TODO Should this be true when all rows are touched?
    get touched() {
      return this.rows.some((r) => r.touched) || this.hasNewItems();
    },

    set touched(touched: boolean) {
      this.rows.forEach((r) => (r.touched = touched));
    },

    rules,

    get valid(): boolean {
      const value = this.rows;
      // TODO Passing `originalCopy || []` is probably not 100% right
      const opts = { value, key: key as string, originalValue: originalCopy || [], object: parentState() };
      const collectionValid = this.rules.every((r) => r(opts as any) === undefined);
      const entriesValid = this.rows.filter((r) => !(r as any)._considerDeleted()).every((r) => r.valid);
      return collectionValid && entriesValid;
    },

    get errors(): string[] {
      if (_tick.value < 0) fail();
      const opts = { value: this.rows, key: key as string, originalValue: originalCopy || [], object: parentState() };
      return this.rules.map((r) => r(opts as any)).filter(isNotUndefined);
    },

    get changedValue() {
      const result = [] as any;
      const hasOpKey = Object.keys(listConfig.config).includes("op");
      const hasLegacyOpKey = Object.keys(listConfig.config).some((key) => key === "delete" || key === "remove");
      const incremental =
        listConfig.update === "incremental" ||
        // Implicitly enable incremental mode if we see an op key
        (listConfig.update === undefined && (hasOpKey || hasLegacyOpKey));
      const exhaustive = !incremental;
      this.rows.forEach((r) => {
        if (exhaustive || r.dirty || r.isNewEntity) {
          const changed = r.changedValue;
          // Ensure we have an `op: include` key, following https://joist-orm.io/docs/features/partial-update-apis
          if (incremental && hasOpKey) {
            (changed as any).op ??= "include";
          }
          result.push(changed);
        }
      });
      return result;
    },

    focus() {
      this._focused = true;
    },

    blur() {
      this._focused = false;
      this.maybeAutoSave();
    },

    maybeAutoSave() {
      this.touched = true;
      maybeAutoSave();
    },

    set(values: U[], opts: InternalSetOpts = {}) {
      if (this.readOnly && !opts.resetting && !opts.refreshing) {
        throw new Error(`${key} is currently readOnly`);
      }
      // We should be passed values that are non-proxies.
      parentInstance[key] = (values.map((value) => {
        let childState = rowMap.get(value);
        if (!childState) {
          // Look for an existing child (requires having an id key configured)
          for (const [, otherState] of rowMap.entries()) {
            if ((otherState as any).isSameEntity(value)) {
              otherState.set(value, opts);
              rowMap.set(value, otherState);
              return otherState.value;
            }
          }

          // If we didn't have an existing child, just make a new object state
          childState = createObjectState(config, value, { maybeAutoSave });
          rowMap.set(value, childState);
        }
        // Return the already-observable'd value so that our `parent.value[key] = values` doesn't re-proxy things
        return childState.value;
      }) as any) as T[K];
      // Reset originalCopy so that our dirty checks have the right # of rows.
      if (opts.refreshing) {
        originalCopy = [...((parentInstance[key] as any) || [])];
      }
      _tick.value++;
    },

    add(value: U, spliceIndex?: number): void {
      // This is called by the user, so value should be a non-proxy value we should keep
      const childState = createObjectState(config, value, { maybeAutoSave });
      rowMap.set(value, childState);
      this.ensureSet();
      this.value.splice(typeof spliceIndex === "number" ? spliceIndex : this.value.length, 0, childState.value);
      _tick.value++;
      maybeAutoSave();
    },

    remove(indexOrValue: number | U): void {
      this.ensureSet();
      if (typeof indexOrValue === "number") {
        this.value.splice(indexOrValue, 1);
      } else {
        const index = this.value.findIndex((v) => v === indexOrValue);
        if (index > -1) {
          this.value.splice(index, 1);
        }
      }
      _tick.value++;
      maybeAutoSave();
    },

    reset() {
      if (originalCopy) {
        this.set(originalCopy, { resetting: true });
        this.rows.forEach((r) => r.reset());
      }
    },

    save() {
      this.rows.forEach((r) => {
        r.save();
      });
      originalCopy = [...((parentInstance[key] as any) || [])];
      _tick.value++;
    },

    ensureSet() {
      if (!parentInstance[key]) {
        (parentInstance as any)[key] = [];
      }
      _tick.value++;
    },
  };

  return makeAutoObservable(list, {
    // See other makeAutoObservable comment
    value: computed({ equals: () => false }),
  }) as any;
}

function isNotUndefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isEmpty(value: any): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * An equals that does deep-ish equality.
 *
 * We only do non-identity equals for:
 *
 * - "plain" objects that have no custom prototype/i.e. are object literals
 * - objects that implement `toJSON`
 *
 */
function areEqual<T>(a?: T, b?: T): boolean {
  if (isPlainObject(a)) {
    return equal(toJS(a), toJS(b));
  }
  if (hasToJSON(a) || hasToJSON(b)) {
    const a1 = hasToJSON(a) ? a.toJSON() : a;
    const b1 = hasToJSON(b) ? b.toJSON() : b;
    return equal(a1, b1);
  }
  if (a && b && a instanceof Array && b instanceof Array) {
    return equal(a, b);
  }
  return a === b;
}

function hasToJSON(o?: unknown): o is { toJSON(): void } {
  return !!(o && typeof o === "object" && "toJSON" in o);
}

type Primitive = undefined | null | boolean | string | number | Function | Date | { toJSON(): any };
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
