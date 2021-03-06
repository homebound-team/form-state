import { isPlainObject } from "is-plain-object";
import { observable, toJS } from "mobx";
import { ObjectState } from "src/fields/objectField";
import { required, Rule } from "src/rules";
import { areEqual, fail, isEmpty, isNotUndefined } from "src/utils";

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
  loading: boolean;
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
  revertChanges(): void;
  /** Accepts the current changed value (if any) as the original and resets dirty/touched. */
  commitChanges(): void;
}

/** Public options for our `set` command. */
export interface SetOpts {
  /** Whether this `set` should trigger an auto-save; defaults to true. */
  autoSave?: boolean;
}

/** Internal `.set` opts for conditionally that form-state internally percolates. */
export interface InternalSetOpts extends SetOpts {
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

export function newValueFieldState<T, K extends keyof T>(
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<T, T[K] | null | undefined>[],
  isIdKey: boolean,
  isDeleteKey: boolean,
  isReadOnlyKey: boolean,
  computed: boolean,
  readOnly: boolean,
  strictOrder: boolean,
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
    _loading: false,
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
      return !areEqual(this.originalValue, this.value, strictOrder);
    },

    /** Returns whether this field is readOnly, although if our parent is readOnly then it trumps. */
    get readOnly(): boolean {
      return parentState().readOnly || this._readOnly;
    },

    /** Sets the field readOnly, but `loading` will still be or-d with the parent's readOnly state. */
    set readOnly(readOnly: boolean) {
      this._readOnly = readOnly;
    },

    /** Returns whether this field is loading, or if our parent is loading. */
    get loading(): boolean {
      return parentState().loading || this._loading;
    },

    /** Sets the field loading, but `loading` will still be or-d with the parent's loading state. */
    set loading(loading: boolean) {
      this._loading = loading;
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
      const changed = !areEqual(newValue, this.value, strictOrder);
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

    revertChanges() {
      if (!computed) {
        this.set(this.originalValue, { resetting: true });
      }
      this.touched = false;
    },

    commitChanges() {
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
