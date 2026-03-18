import { isPlainObject } from "is-plain-object";
import { observablePrimitive, observable as lsObservable } from "@legendapp/state";
import { ObjectState } from "src/fields/objectField";
import { newDelegateProxy } from "src/proxies";
import { Rule, required } from "src/rules";
import { areEqual, fail, isEmpty, isNotUndefined } from "src/utils";

/**
 * Form state for a primitive field in the form, i.e. its value but also touched/validation/etc. state.
 *
 * This API also provides hooks for form elements to call into, i.e. `blur()` and `set(...)` that will
 * update the field state and re-render, i.e. when including in an `ObjectState`-typed literal that is
 * observable.
 *
 * Note that `V` will always have `null | undefined` added to it by `FieldStates`, b/c most form fields
 * i.e. text boxes, can always be cleared out/deleted.
 */
export interface FieldState<V> {
  /** The key in the parent object, i.e. `firstName` in `author: { firstName: string }`. */
  readonly key: string;
  /** The current value of the field. */
  value: V;
  readonly originalValue: V;
  touched: boolean;
  readOnly: boolean;
  loading: boolean;
  readonly required: boolean;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly focused: boolean;
  readonly isNewEntity: boolean;
  rules: Rule<V>[];
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
  /** Creates a new FieldState with a transformation of the value, i.e. string to int, or feet to inches. */
  adapt<V2>(adapter: ValueAdapter<V, V2>): FieldState<V2>;
}

/**
 * Allows changing a type in the formState (like a string) to a different type in the UI (like a number).
 *
 * Or doing unit of measure conversions within the same type, like from meters to feet.
 */
export interface ValueAdapter<V, V2 = V> {
  /** Converts the original FieldState's value `V` into new `V2` type. */
  toValue(value: V): V2;
  /** Converts the adapted FieldState's value `V2` back into the original `V` type. */
  fromValue(value: V2): V;
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

export interface FieldStateInternal<T, V> extends FieldState<V> {
  set(value: V, opts?: InternalSetOpts): void;
  _isIdKey: boolean;
  _isDeleteKey: boolean;
  _isReadOnlyKey: boolean;
  _isLocalOnly: boolean;
}

export function newValueFieldState<T, K extends keyof T>(
  parentCopy: T,
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<T[K] | null | undefined>[],
  isIdKey: boolean,
  isDeleteKey: boolean,
  isReadOnlyKey: boolean,
  isLocalOnly: boolean,
  computed: boolean,
  readOnly: boolean,
  strictOrder: boolean,
  maybeAutoSave: () => void,
): FieldState<T[K] | null | undefined> {
  type V = T[K];

  // Because we read/write the value directly back into parentInstance[key],
  // which itself is not a proxy, we use this as our "value changed" trigger.
  const _tick = observablePrimitive(1);
  const _originalValueTick = observablePrimitive(1);
  // Track "this is probably what we put into a mutation to the server" to allow
  // use to better accept server acks/responses that change our initial submission.
  let hasInflightChangedValue = false;
  let lastChangedValue: V | undefined = undefined;

  // Mutable state backed by Legend-State observables for reactivity
  const _touched = observablePrimitive(false);
  const _readOnly = observablePrimitive(readOnly || false);
  const _loading = observablePrimitive(false);
  const _focused = observablePrimitive(false);
  const _rules = lsObservable(rules);

  const field = {
    key: key as string,

    get touched() {
      return _touched.get();
    },
    set touched(v: boolean) {
      _touched.set(v);
    },

    _isIdKey: isIdKey,
    _isDeleteKey: isDeleteKey,
    _isReadOnlyKey: isReadOnlyKey,
    _isLocalOnly: isLocalOnly,
    _kind: "value",
    // Expose so computed can be skipped in changedValue
    _computed: computed,

    get rules(): Rule<V | null | undefined>[] {
      return _rules.get();
    },
    set rules(v: Rule<V | null | undefined>[]) {
      _rules.set(v);
    },

    get value(): V {
      const value = _tick.get() > 0 ? parentInstance[key] : fail();
      // Re-create the `keepNull` logic on sets but for our initial read where our
      // originalValue is null (empty) but we want to expose it as undefined for
      // consistency of "empty-ness" to our UI components.
      return value === null && isEmpty(parentCopy[key]) ? (undefined as any) : value;
    },

    set value(v: V) {
      this.set(v);
    },

    get focused(): boolean {
      return _focused.get();
    },

    get dirty(): boolean {
      return !areEqual(this.originalValue, this.value, strictOrder);
    },

    /** Returns whether this field is readOnly, although if our parent is readOnly then it trumps. */
    get readOnly(): boolean {
      return parentState().readOnly || _readOnly.get();
    },

    /** Sets the field readOnly, but `loading` will still be or-d with the parent's readOnly state. */
    set readOnly(readOnly: boolean) {
      _readOnly.set(readOnly);
    },

    /** Returns whether this field is loading, or if our parent is loading. */
    get loading(): boolean {
      return parentState().loading || _loading.get();
    },

    /** Sets the field loading, but `loading` will still be or-d with the parent's loading state. */
    set loading(loading: boolean) {
      _loading.set(loading);
    },

    // For primitive fields, the changed value is just the value.
    get changedValue() {
      // Add some hints to let `set(..., { refreshing: true })` accept server-driven changes to our value,
      // if the user hasn't changed it yet-again while the changedValue was in in-flight.
      hasInflightChangedValue = true;
      lastChangedValue = this.value;
      // Usually if we see a field being unset, we set `parent[key] = null`, but if we're wrapping
      // an observable object, it might have changed to `undefined` without us being able to
      // tell it to be `null` (and potentially break the type contract of `string | undefined`).
      // So detect un-set-ness here and return `null`.
      if (this.value === undefined && this.originalValue !== undefined) return null;
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
      _focused.set(true);
    },

    blur() {
      this.maybeAutoSave();
      _focused.set(false);
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
        throw new Error(`${String(key)} is currently readOnly`);
      }

      if (computed && (opts.resetting || opts.refreshing)) {
        // Computeds can't be either reset or refreshed
        return;
      }

      if (opts.refreshing && this.dirty) {
        // See if we should ignore the incoming server-side value, to avoid dropping local WIP changes
        const isAckingUnset = this.value === null && (value === null || value === undefined);
        const acceptServerAck =
          hasInflightChangedValue &&
          this.value === lastChangedValue &&
          // If value === originalValue, this is likely a cache refresh firing in-between "we put the new value
          // on the wire" and "the server acked our change". Granted, this heuristic means that if the server
          // really does reject/rollback our change, we'll ignore it, but atm we don't have a way of differentiating
          // "this refresh is from a pre-response cache refresh" vs. "post-response cache refresh".
          value !== this.originalValue;
        // Ignore incoming values if we have changes (this.dirty) unless:
        // - our latest change (this.value) matches the incoming value (value), i.e. the server
        //   is exactly acking our change, or
        // - the user hasn't made any changes since `.changedValue` was put on the wire, i.e. the
        //   server received our value, but wanted to change it.
        const keepLocalWipChange = this.value !== value && !isAckingUnset && !acceptServerAck;
        if (keepLocalWipChange) return;
      }

      // If the user has deleted/emptied a value that was originally set, keep it as `null`
      // so that our partial update to the backend correctly unsets it.
      const keepNull = !isEmpty(this.originalValue) && isEmpty(value) && !opts.refreshing;
      // If a list of primitives was originally undefined, coerce `[]` to `undefined`
      const coerceEmptyList = value && value instanceof Array && value.length === 0 && isEmpty(this.originalValue);
      const newValue = keepNull ? null : isEmpty(value) || coerceEmptyList ? undefined : value;

      hasInflightChangedValue = false;

      // Set the value on our parent object
      const changed = !areEqual(newValue, this.value, strictOrder);
      if (!changed && !opts.refreshing) return;
      parentInstance[key] = newValue!;
      _tick.set((t) => t + 1);

      if (opts.refreshing) {
        this.originalValue = newValue as any;
      }
      // If we're being set programmatically, i.e. we don't currently have focus,
      // call blur to trigger any auto-saves.
      if (!_focused.peek() && !opts.refreshing && !opts.resetting && this.dirty && changed && opts.autoSave !== false) {
        this.maybeAutoSave();
      }
    },

    adapt<V2>(adapter: ValueAdapter<V, V2>): FieldState<V2> {
      return adapt(this, adapter);
    },

    revertChanges() {
      if (!computed) {
        this.set(this.originalValue, { resetting: true });
      }
      this.touched = false;
    },

    commitChanges() {
      if (isPlainObject(this.originalValue)) {
        this.originalValue = JSON.parse(JSON.stringify(this.value));
      } else {
        this.originalValue = this.value;
      }
      this.touched = false;
    },

    get originalValue(): V {
      // A dummy check to for reactivity around our non-proxy value
      const value = _originalValueTick.get() > -1 ? parentCopy[key] : parentCopy[key];
      // Re-create the `keepNull` logic so that `.value` === `.originalValue`
      return value === null ? (undefined as any) : value;
    },

    set originalValue(v: V) {
      const canSkip = v === undefined && !(key in (parentCopy as any));
      if (!canSkip) parentCopy[key] = v;
      _originalValueTick.set((t) => t + 1);
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

/**
 * Returns a proxy that looks exactly like the original `field`, in terms of valid/touched/errors/etc., but
 * has any methods that use `V` overridden to use be `V2`.
 *
 * Note that `V2` can be a new type, like string -> number, or just a transformation on the same
 * type, i.e. feet -> inches where both are `number`s.
 */
function adapt<V, V2>(field: FieldState<V>, adapter: ValueAdapter<V, V2>): FieldState<V2> {
  return newDelegateProxy(field, {
    rules: [],
    get value(): V2 {
      return adapter.toValue(field.value);
    },
    set value(v: V2) {
      field.value = adapter.fromValue(v);
    },
    set: (v: V2) => {
      field.value = adapter.fromValue(v);
    },
    get changedValue(): V2 {
      return this.value;
    },
    adapt<V3>(adapter: ValueAdapter<V2, V3>) {
      return adapt(this, adapter);
    },
    get originalValue(): V2 {
      return adapter.toValue(field.originalValue);
    },
  });
}
