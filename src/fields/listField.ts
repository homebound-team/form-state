import { batch, observablePrimitive } from "@legendapp/state";
import { ListFieldConfig, ObjectFieldConfig } from "src/config";
import { ObjectState, ObjectStateInternal, newObjectState } from "src/fields/objectField";
import { FieldState, InternalSetOpts } from "src/fields/valueField";
import { Rule, required } from "src/rules";
import { fail, groupBy, isNotUndefined } from "src/utils";
import hash from "object-hash";

/** Form state for list of children, i.e. `U` is a `Book` in a form with a `books: Book[]`. */
export interface ListFieldState<U> extends FieldState<U[]> {
  readonly rows: ReadonlyArray<ObjectState<U>>;

  add(value: U, index?: number): void;

  remove(indexOrValue: number | U): void;
}

export function newListFieldState<T, K extends keyof T, U>(
  // parentCopy is objectField's deepClone-d `originalCopy` that it/we use for `dirty` checking
  parentCopy: T,
  // parentInstance is objectField's `instance`, that we're currently mutating
  parentInstance: T,
  parentState: () => ObjectState<T>,
  key: K,
  rules: Rule<readonly ObjectState<U>[]>[],
  listConfig: ListFieldConfig<U>,
  config: ObjectFieldConfig<U>,
  strictOrder: boolean,
  maybeAutoSave: () => void,
  deepExhaustive: boolean,
): ListFieldState<U> {
  // Keep a map of "item in the parentInstance list" -> "that item's ObjectState"
  const rowMap = new Map<U, ObjectStateInternal<U>>();
  const addedRows = new Set<U>();
  const _tick = observablePrimitive(1);
  const _originalValueTick = observablePrimitive(1);

  // Mutable state backed by Legend-State observables
  const _readOnly = observablePrimitive(false);
  const _loading = observablePrimitive(false);
  const _focused = observablePrimitive(false);
  const _touched = observablePrimitive(false);

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
        listConfig.update === "deep-exhaustive" ?? deepExhaustive,
      ) as ObjectStateInternal<U>;
      rowMap.set(child, childState);
    }
    return childState;
  }

  const list = {
    key: key as string,

    // Our fundamental state of wrapped Us
    get value() {
      if (!(_tick.get() > 0)) fail();
      // Track child row values so observers of our value see deep changes
      this.rows.forEach((r) => r.value);
      return (parentInstance[key] ?? []) as any as U[];
    },

    _kind: "list",

    get readOnly(): boolean {
      return _readOnly.get() || parentState().readOnly;
    },

    set readOnly(readOnly: boolean) {
      _readOnly.set(readOnly);
    },

    get loading(): boolean {
      return _loading.get() || parentState().loading;
    },

    set loading(loading: boolean) {
      _loading.set(loading);
    },

    set value(v: U[]) {
      this.set(v);
    },

    get dirty(): boolean {
      return this.rows.some((r) => r.dirty) || this.hasChanged();
    },

    // Having a new entity is slightly different than being dirty, b/c merely having a placeholder-but-not-changed-yet
    // `isNewEntity` child should not fire autosave (which would happen if we're dirty).
    get hasNewEntity(): boolean {
      return this.rows.some((r) => r.isNewEntity);
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
      // Access _tick to register as a dependency
      if (_tick.get() < 0) fail();
      // Avoid using `this.value` to avoid registering `_childTick` as a dependency
      const value = parentInstance[key] as any as U[];
      return (value || []).map((child) => getOrCreateChildState(child, { skipSet: true }));
    },

    get touched() {
      return _touched.get() || this.rows.some((r) => r.touched) || this.hasChanged();
    },

    set touched(touched: boolean) {
      _touched.set(touched);
      this.rows.forEach((r) => (r.touched = touched));
    },

    rules,

    get valid(): boolean {
      const value = this.rows;
      const opts = { value, key: key as string, originalValue: this.originalValue, object: parentState() };
      const collectionValid = this.rules.every((r) => r(opts as any) === undefined);
      const entriesValid = this.rows.filter((r) => !(r as any)._considerDeleted()).every((r) => r.valid);
      return collectionValid && entriesValid;
    },

    get errors(): string[] {
      if (_tick.get() < 0) fail();
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
      _focused.set(true);
    },

    blur() {
      _focused.set(false);
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
      batch(() => {
        // Given the values, see if we've got existing child states, and use their
        // value if so. I.e. this covers revertChanges doing `set(originalValue)` and
        // passing us cloned rows from the parentCopy, but `getOrCreateChildState` will
        // use the `copyMap` to recover the non-cloned rows, to avoid promoting the clone
        // into a real row.
        if ((this.dirty || this.hasNewEntity) && opts.refreshing) {
          // When refreshing a dirty list, we need to preserve WIP values

          // Start with current list, then merge in incoming changes
          const currentItems = this.value || [];
          const incomingItems = values || [];
          const mergedItems: U[] = [];

          // Index by idKey or a hash of the object, so we don't have to n^2 merging
          const idKey = this.rows.length > 0 && (this.rows[0] as any as ObjectStateInternal).idKey;
          const contentKeys = Object.entries(config.config)
            .filter(([key, cfg]: any) => key !== idKey && cfg.type === "value")
            .map(([key]) => key);
          const hashByContent = (item: any) =>
            hash(Object.fromEntries(Object.entries(item as object).filter(([key]) => contentKeys.includes(key))));
          const hashById = (item: any) => (idKey && item[idKey]) || hashByContent(item);
          const currentById = groupBy(currentItems, hashById);
          const incomingById = groupBy(incomingItems, hashById);
          const incomingByContent =
            idKey && currentItems.some((item) => !(item as any)[idKey]) && groupBy(incomingItems, hashByContent);

          const hasOpKey = Object.keys(listConfig.config).includes("op");

          for (const currentItem of currentItems) {
            const childState = rowMap.get(currentItem)!;
            const hash = hashById(currentItem);
            const match = (incomingById.get(hash)?.[0] ??
              (!!idKey && !(currentItem as any)[idKey] && !!incomingByContent && incomingByContent?.get(hash)?.[0])) as
              | U
              | undefined;
            if (match) {
              childState.set(match, opts);
              mergedItems.push(childState.value);
              addedRows.delete(currentItem);
            } else if (!childState.dirty && !childState.isNewEntity && !addedRows.has(currentItem)) {
              // Local is not dirty/added, and it's not upstream, so let it get removed
            } else if (hasOpKey && (currentItem as any).op === "delete") {
              // We were locally marked as deleted, and not finding a match is the server acking that we're gone
            } else if (
              currentItems.length === incomingItems.length &&
              !!idKey &&
              (currentItem as any)[idKey] === undefined
            ) {
              // Assume our newly-assigned id is coming back
            } else {
              mergedItems.push(currentItem);
            }
          }

          for (const incomingItem of incomingItems) {
            const match =
              currentById.get(hashById(incomingItem))?.[0] || currentById.get(hashByContent(incomingItem))?.[0];
            if (!match) {
              const childState = getOrCreateChildState(incomingItem, opts);
              mergedItems.push(childState.value);
            }
          }

          parentInstance[key] = mergedItems as any as T[K];
          _tick.set((t) => t + 1);

          this.setOriginalValue(incomingItems);
        } else {
          parentInstance[key] = (values ?? []).map((child) => getOrCreateChildState(child, opts).value) as any as T[K];
          _tick.set((t) => t + 1);
          if (opts.refreshing) {
            this.setOriginalValue();
          }
        }
      });
    },

    add(value: U, spliceIndex?: number): void {
      batch(() => {
        // This is called by the user, so value should be a non-proxy value we should keep
        const childState = getOrCreateChildState(value) as ObjectStateInternal<U>;
        rowMap.set(value, childState);
        // Let `.set` know this is a new row
        addedRows.add(value);
        this.ensureSet();
        this.value.splice(typeof spliceIndex === "number" ? spliceIndex : this.value.length, 0, childState.value);
        _tick.set((t) => t + 1);
      });
      maybeAutoSave();
    },

    remove(indexOrValue: number | U): void {
      batch(() => {
        this.ensureSet();
        if (typeof indexOrValue === "number") {
          this.value.splice(indexOrValue, 1);
        } else {
          const index = this.value.findIndex((v) => v === indexOrValue);
          if (index > -1) {
            this.value.splice(index, 1);
          }
        }
        _tick.set((t) => t + 1);
      });
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
      _tick.set((t) => t + 1);
    },

    get originalValue(): U[] {
      // A dummy check to for reactivity around our non-proxy value
      const value = _originalValueTick.get() > -1 ? parentCopy[key] : parentCopy[key];
      return value ?? ([] as any);
    },

    // This should only be called when value === originalValue
    setOriginalValue(incomingItems?: U[]) {
      // Use the rows' originalValues to update the parentCopy
      parentCopy[key] = incomingItems ?? (this.rows.map((r) => r.originalValue) as any);
      (parentCopy[key] as U[]).forEach((copy, i) => {
        copyMap.set(copy, (parentInstance[key] as any)[i]);
      });
      _originalValueTick.set((t) => t + 1);
    },

    ensureSet() {
      if (!parentInstance[key]) {
        (parentInstance as any)[key] = [];
      }
      _tick.set((t) => t + 1);
    },
  };

  return list as any;
}
