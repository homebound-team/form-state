import { computed, makeAutoObservable, observable, reaction } from "mobx";
import { ListFieldConfig, ObjectConfig } from "src/config";
import { ObjectState, ObjectStateInternal, createObjectState, newObjectState } from "src/fields/objectField";
import { FieldState, InternalSetOpts } from "src/fields/valueField";
import { Rule, required } from "src/rules";
import { fail, isNotUndefined } from "src/utils";

/** Form state for list of children, i.e. `U` is a `Book` in a form with a `books: Book[]`. */
export interface ListFieldState<U> extends FieldState<U[]> {
  readonly rows: ReadonlyArray<ObjectState<U>>;

  add(value: U, index?: number): void;

  remove(indexOrValue: number | U): void;
}

export function newListFieldState<T, K extends keyof T, U>(
  parentCopy: T,
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<readonly ObjectState<U>[]>[],
  listConfig: ListFieldConfig<U>,
  config: ObjectConfig<U>,
  strictOrder: boolean,
  maybeAutoSave: () => void,
): ListFieldState<U> {
  // Keep a map of "item in the parent list" -> "that item's ObjectState"
  const rowMap = new Map<U, ObjectStateInternal<U>>();
  const _tick = observable({ value: 1 });
  const _originalValueTick = observable({ value: 1 });
  const _childTick = observable({ value: 1 });

  // When child rows don't have ids (i.e. for new rows that aren't saved yet), we need an id-less
  // "clone <-> current" map to tell if we're dirty or not, i.e. whether `parentInstance[key]` has
  // drifted from `parentCopy[key]`
  const copyMap = new Map<U, U>();
  ((parentCopy[key] ?? []) as U[]).forEach((copy, i) => {
    copyMap.set(copy, (parentInstance[key] as any)[i]);
  });

  // Given a child POJO (or a copy/clone of a child POJO), return its ObjectState wrapper.
  function getOrCreateChildState(child: U, opts?: InternalSetOpts & { skipSet?: boolean }): ObjectState<U> {
    let childState = rowMap.get(child);
    // If we're being reverted to our originalValue, i.e. values is actually
    // a list of copies, use the copyMap to recover the non-copy original value
    if (!childState && copyMap.has(child)) {
      childState = rowMap.get(copyMap.get(child)!);
    }
    // Look for an existing child (requires having an id key configured)
    if (!childState) {
      for (const [, otherState] of rowMap.entries()) {
        if (otherState.isSameEntity(child)) {
          // If we're being called from `list.rows`, we should be careful to not trigger mutations
          if (!opts?.skipSet) otherState.set(child, opts);
          rowMap.set(child, otherState);
          return otherState;
        }
      }
    }
    // If we didn't have an existing child, just make a new object state
    if (!childState) {
      childState = newObjectState<U>(
        config,
        parentState as any,
        undefined,
        list as any as FieldState<any>,
        child,
        undefined,
        maybeAutoSave,
      ) as ObjectStateInternal<U>;
      rowMap.set(child, childState);
    }
    return childState;
  }

  const list = {
    key: key as string,

    // Our fundamental state of wrapped Us
    get value() {
      return _tick.value > 0 && _childTick.value > 0 ? (parentInstance[key] as any as U[]) : fail();
    },

    _focused: false,
    _readOnly: false,
    _loading: false,

    get readOnly(): boolean {
      return this._readOnly || parentState().readOnly;
    },

    set readOnly(readOnly: boolean) {
      this._readOnly = readOnly;
    },

    get loading(): boolean {
      return this._loading || parentState().loading;
    },

    set loading(loading: boolean) {
      this._loading = loading;
    },

    set value(v: U[]) {
      this.set(v);
    },

    get dirty(): boolean {
      return this.rows.some((r) => r.dirty) || this.hasChanged();
    },

    get focused(): boolean {
      return this.rows.some((r) => r.focused);
    },

    get required(): boolean {
      return this.rules.some((rule) => rule === required);
    },

    get isNewEntity(): boolean {
      return parentState().isNewEntity;
    },

    // private
    /** Returns whether a row has been added/removed. */
    hasChanged(): boolean {
      const [current, original] = [this.value || [], this.originalValue];
      if (current.length !== original.length) return true;
      if (strictOrder) {
        // With strict order, every copy[i] === original[i] must be true
        return original.some((e, idx) => current[idx] !== copyMap.get(e));
      } else {
        // With loose order, we just want every copy to still have its original somewhere
        return !original.every((e) => current.includes(copyMap.get(e)!));
      }
    },

    // And we can derive each value's ObjectState wrapper as needed from the rowMap cache
    get rows(): readonly ObjectState<U>[] {
      // It's unclear why we need to access _tick.value here, b/c calling `this.value` should
      // transitively register us as a dependency on it
      if (_tick.value < 0) fail();
      // Avoid using `this.value` to avoid registering `_childTick` as a dependency
      const value = parentInstance[key] as any as U[];
      return (value || []).map((child) => getOrCreateChildState(child, { skipSet: true }));
    },

    // TODO Should this be true when all rows are touched?
    get touched() {
      return this.rows.some((r) => r.touched) || this.hasChanged();
    },

    set touched(touched: boolean) {
      this.rows.forEach((r) => (r.touched = touched));
    },

    rules,

    get valid(): boolean {
      const value = this.rows;
      // TODO Passing `originalCopy || []` is probably not 100% right
      const opts = { value, key: key as string, originalValue: this.originalValue, object: parentState() };
      const collectionValid = this.rules.every((r) => r(opts as any) === undefined);
      const entriesValid = this.rows.filter((r) => !(r as any)._considerDeleted()).every((r) => r.valid);
      return collectionValid && entriesValid;
    },

    get errors(): string[] {
      if (_tick.value < 0) fail();
      const opts = { value: this.rows, key: key as string, originalValue: this.originalValue, object: parentState() };
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
        throw new Error(`${String(key)} is currently readOnly`);
      }
      // Given the values, see if we've got existing child states, and use their
      // value if so. I.e. this covers revertChanges doing `set(originalValue)` and
      // passing us cloned rows from the parentCopy, but `getOrCreateChildState` will
      // use the `copyMap` to recover the non-cloned rows, to avoid promoting the clone
      // into a real row.
      parentInstance[key] = values.map((child) => getOrCreateChildState(child, opts).value) as any as T[K];
      // Make sure to tick first so that `setOriginalValue` sees the latest `rows`
      _tick.value++;
      // Reset originalCopy so that our dirty checks have the right # of rows.
      if (opts.refreshing) {
        this.setOriginalValue();
      }
    },

    add(value: U, spliceIndex?: number): void {
      // This is called by the user, so value should be a non-proxy value we should keep
      const childState = createObjectState(config, value, { maybeAutoSave }) as ObjectStateInternal<U>;
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

    revertChanges() {
      this.set(this.originalValue, { resetting: true });
      this.rows.forEach((r) => r.revertChanges());
      this.touched = false;
    },

    commitChanges() {
      // Tell each child ObjectState to have its fields commit into its parentCopy
      this.rows.forEach((r) => r.commitChanges());
      this.setOriginalValue();
      this.touched = false;
      _tick.value++;
    },

    get originalValue(): U[] {
      // A dummy check to for reactivity around our non-proxy value
      const value = _originalValueTick.value > -1 ? parentCopy[key] : parentCopy[key];
      return value ?? ([] as any);
    },

    // This should only be called when value === originalValue
    setOriginalValue() {
      // Use the rows' originalValues to update the parentCopy
      parentCopy[key] = this.rows.map((r) => r.originalValue) as any;
      (parentCopy[key] as U[]).forEach((copy, i) => {
        copyMap.set(copy, (parentInstance[key] as any)[i]);
      });
      _originalValueTick.value++;
    },

    ensureSet() {
      if (!parentInstance[key]) {
        (parentInstance as any)[key] = [];
      }
      _tick.value++;
    },
  };

  const proxy = makeAutoObservable(list, {
    // See other makeAutoObservable comment
    value: computed({ equals: () => false }),
  }) as any;

  // Any time a row's value changes, percolate that to our `.value` (so the callers to our
  // `.value` will rerun given the value they saw has deeply changed.)
  reaction(
    () => proxy.rows.map((r: any) => r.value),
    () => _childTick.value++,
  );

  return proxy;
}
