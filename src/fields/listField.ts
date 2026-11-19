import { type IAtom, computed, createAtom, makeAutoObservable } from "mobx";
import hash from "object-hash";
import { type ListFieldConfig, type ObjectFieldConfig } from "src/config";
import { type ObjectState, type ObjectStateInternal, newObjectState } from "src/fields/objectField";
import {
  activateSubscriptions,
  deactivateSubscriptions,
  registerSubscriptions,
  subscriptionsActive,
} from "src/fields/subscriptions";
import { type FieldState, type InternalSetOpts } from "src/fields/valueField";
import { type Rule, required } from "src/rules";
import { groupBy, isNotUndefined, normalizeHashValue, shallowEquals } from "src/utils";

/** Form state for list of children, i.e. `U` is a `Book` in a form with a `books: Book[]`. */
export interface ListFieldState<U> extends FieldState<U[]> {
  readonly rows: ReadonlyArray<ObjectState<U>>;

  add(value: U, index?: number): void;

  remove(indexOrValue: number | U): void;
}

/** Creates the `ListFieldState` for the `key` list of `parentInstance`. */
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
  const list = new ListFieldStateImpl<T, K, U>(
    parentCopy,
    parentInstance,
    parentState,
    key,
    rules,
    listConfig,
    config,
    strictOrder,
    maybeAutoSave,
  );
  return list as unknown as ListFieldState<U>;
}

/** The members of `ListFieldStateImpl` that are implementation details, and so are not observable. */
type ListFieldStatePrivates =
  | "_parentCopy"
  | "_parentInstance"
  | "_parentState"
  | "_key"
  | "_listConfig"
  | "_config"
  | "_strictOrder"
  | "_requestAutoSave"
  | "_rowMap"
  | "_aliases"
  | "_addedRows"
  | "_valueAtom"
  | "_originalValueAtom"
  | "_copyMap"
  | "getOrCreateChildState"
  | "getRow"
  | "findSameEntity"
  | "indexRowsById";

/**
 * The `ListFieldState` implementation.
 *
 * This is a class, instead of an object literal, to match `ValueFieldState` and `ObjectStateImpl`:
 * the methods are on the prototype, and the row caches and atoms are private fields.
 */
class ListFieldStateImpl<T, K extends keyof T, U> {
  readonly key: string;

  readonly _kind = "list";
  _focused = false;
  _readOnly = false;
  _loading = false;

  rules: Rule<readonly ObjectState<U>[]>[];

  private readonly _parentCopy: T;
  private readonly _parentInstance: T;
  private readonly _parentState: () => ObjectState<T>;
  private readonly _key: K;
  private readonly _listConfig: ListFieldConfig<U>;
  private readonly _config: ObjectFieldConfig<U>;
  private readonly _strictOrder: boolean;
  private readonly _requestAutoSave: () => void;

  // Keep a map of "item in the parentInstance list" -> "that item's ObjectState"
  private readonly _rowMap = new Map<U, ObjectStateInternal<U>>();
  // We might see multiple POJO instances for the same entity (i.e. a cache refresh passes new
  // objects with the same ids), and want them all to resolve to the same ObjectState instance.
  // So while `rowMap` holds the first POJO instance we saw for each row, `aliases` holds every
  // later instance. These are weak, so that each refresh's objects can be collected, instead
  // of piling up in `rowMap`.
  private readonly _aliases = new WeakMap<object, ObjectStateInternal<U>>();
  private readonly _addedRows = new Set<U>();
  // `parentInstance[key]` and `parentCopy[key]` are not proxies, so we use atoms as our
  // "rows added/removed" and "original value changed" triggers.
  private readonly _valueAtom: IAtom;
  private readonly _originalValueAtom: IAtom;

  // When child rows don't have ids (i.e. for new rows that aren't saved yet), we need an id-less
  // "clone <-> current" map to tell if we're dirty or not, i.e. whether `parentInstance[key]` has
  // drifted from `parentCopy[key]`
  //
  // This is weak so that the copies of each past original value can be collected.
  private readonly _copyMap = new WeakMap<object, U>();

  constructor(
    parentCopy: T,
    parentInstance: T,
    parentState: () => ObjectState<T>,
    key: K,
    rules: Rule<readonly ObjectState<U>[]>[],
    listConfig: ListFieldConfig<U>,
    config: ObjectFieldConfig<U>,
    strictOrder: boolean,
    maybeAutoSave: () => void,
  ) {
    this.key = key as string;
    this.rules = rules;

    this._parentCopy = parentCopy;
    this._parentInstance = parentInstance;
    this._parentState = parentState;
    this._key = key;
    this._listConfig = listConfig;
    this._config = config;
    this._strictOrder = strictOrder;
    this._requestAutoSave = maybeAutoSave;
    this._valueAtom = createAtom(`${String(key)}.value`);
    this._originalValueAtom = createAtom(`${String(key)}.originalValue`);

    ((parentCopy[key] ?? []) as U[]).forEach((copy, i) => {
      this._copyMap.set(copy as object, (parentInstance[key] as any)[i]);
    });

    makeAutoObservable<ListFieldStateImpl<T, K, U>, ListFieldStatePrivates>(this, {
      // Skip mobx tracking for constants: they cannot change, so observing them is wasted work
      key: false,
      _kind: false,
      // Same for private members, which no observer reads. This also keeps `rowMap` and
      // `addedRows` as a plain Map and Set, and the row lookups as plain functions.
      _parentCopy: false,
      _parentInstance: false,
      _parentState: false,
      _key: false,
      _listConfig: false,
      _config: false,
      _strictOrder: false,
      _requestAutoSave: false,
      _rowMap: false,
      _aliases: false,
      _addedRows: false,
      _valueAtom: false,
      _originalValueAtom: false,
      _copyMap: false,
      getOrCreateChildState: false,
      getRow: false,
      findSameEntity: false,
      indexRowsById: false,
      // Not a computed, so that our value fields see every read, see `ValueFieldState.changedValue`
      changedValue: false,
      // See other makeAutoObservable comment
      value: computed({ equals: () => false }),
      // Our rules return a new array each time, so only tell observers when the messages change
      errors: computed<string[]>({ equals: shallowEquals }),
    });

    registerSubscriptions(this, {
      activate: () => {
        this._rowMap.forEach((row) => activateSubscriptions(row));
      },
      deactivate: () => {
        this._rowMap.forEach((row) => deactivateSubscriptions(row));
      },
    });
  }

  // Our fundamental state of wrapped Us
  get value(): U[] {
    // Read each row's value so observers of our `value` re-run when a row deeply changes,
    // not just when rows are added/removed (which is what `valueAtom` tracks).
    // (`rows` itself observes `valueAtom`.)
    this.rows.forEach((r) => r.value);
    return (this._parentInstance[this._key] ?? []) as any as U[];
  }

  set value(v: U[]) {
    this.set(v);
  }

  get readOnly(): boolean {
    return this._readOnly || this._parentState().readOnly;
  }

  set readOnly(readOnly: boolean) {
    this._readOnly = readOnly;
  }

  get loading(): boolean {
    return this._loading || this._parentState().loading;
  }

  set loading(loading: boolean) {
    this._loading = loading;
  }

  get dirty(): boolean {
    return this.rows.some((r) => r.dirty) || this.hasChanged();
  }

  // Having a new entity is slightly different than being dirty, b/c merely having a placeholder-but-not-changed-yet
  // `isNewEntity` child should not fire autosave (which would happen if we're dirty).
  get hasNewEntity(): boolean {
    return this.rows.some((r) => r.isNewEntity);
  }

  get focused(): boolean {
    return this.rows.some((r) => r.focused);
  }

  get required(): boolean {
    return this.rules.some((rule) => rule === required);
  }

  get isNewEntity(): boolean {
    return this._parentState().isNewEntity;
  }

  // private
  /** Returns whether a row has been added/removed. */
  hasChanged(): boolean {
    const [current, original] = [this.value || [], this.originalValue];
    if (current.length !== original.length) return true;
    if (this._strictOrder) {
      // With strict order, every copy[i] === original[i] must be true
      return original.some((e, idx) => current[idx] !== this._copyMap.get(e as object));
    } else {
      // With loose order, we just want every copy to still have its original somewhere
      return !original.every((e) => current.includes(this._copyMap.get(e as object)!));
    }
  }

  // And we can derive each value's ObjectState wrapper as needed from the rowMap cache
  get rows(): readonly ObjectState<U>[] {
    // Re-run when rows are added/removed
    this._valueAtom.reportObserved();
    // Read `parentInstance[key]` directly (not `this.value`), because `value` reads `rows`
    const value = this._parentInstance[this._key] as any as U[];
    return (value || []).map((child) => this.getOrCreateChildState(child, { skipSet: true }));
  }

  // TODO Should this be true when all rows are touched?
  get touched() {
    return this.rows.some((r) => r.touched) || this.hasChanged();
  }

  set touched(touched: boolean) {
    this.rows.forEach((r) => (r.touched = touched));
  }

  get valid(): boolean {
    const collectionValid = this.errors.length === 0;
    const entriesValid = this.rows.filter((r) => !(r as any)._considerDeleted()).every((r) => r.valid);
    return collectionValid && entriesValid;
  }

  /** Returns the errors from our own collection-level rules (not the rows' errors). */
  get errors(): string[] {
    // TODO Passing `originalCopy || []` is probably not 100% right
    const opts = { value: this.rows, key: this.key, originalValue: this.originalValue, object: this._parentState() };
    return this.rules.map((r) => r(opts as any)).filter(isNotUndefined);
  }

  get changedValue() {
    const listConfig = this._listConfig;
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
  }

  focus() {
    this._focused = true;
  }

  blur() {
    this._focused = false;
    this.maybeAutoSave();
  }

  maybeAutoSave() {
    this.touched = true;
    this._requestAutoSave();
  }

  set(values: U[], opts: InternalSetOpts = {}) {
    const parentInstance = this._parentInstance;
    const key = this._key;
    if (this.readOnly && !opts.resetting && !opts.refreshing) {
      throw new Error(`${String(key)} is currently readOnly`);
    }
    // Given the values, see if we've got existing child states, and use their
    // value if so. I.e. this covers revertChanges doing `set(originalValue)` and
    // passing us cloned rows from the parentCopy, but `getOrCreateChildState` will
    // use the `copyMap` to recover the non-cloned rows, to avoid promoting the clone
    // into a real row.
    if ((this.dirty || this.hasNewEntity) && opts.refreshing) {
      // When refreshing a dirty list, we need to preserve WIP values

      // Start with current list, then merge in incoming changes
      //
      // These will all be POJOs, where `currentItems` existing in our `parentInstance`, and
      // `incomingItems` could really be any of:
      // - an instance from `parentInstance[key]` that user code is passing back in
      // - an instance from `parentCopy[key]` that a cache refresh is passing in
      // - a new instance, either from a cache refresh or user code, that we haven't seen yet
      const currentItems = this.value || [];
      const incomingItems = values || [];
      const mergedItems: U[] = [];

      // Index by idKey or a hash of the object, so we don't have to n^2 merging
      const idKey = this.rows.length > 0 && (this.rows[0] as any as ObjectStateInternal).idKey;
      // Look at our child config, i.e. `bookConfig` and find the non-id / non-list keys
      const contentKeys = Object.entries(this._config.config)
        .filter(([key, cfg]: any) => key !== idKey && cfg.type === "value")
        .map(([key]) => key);
      const hashByContent = (item: any) =>
        hashValue(
          normalizeHashValue(
            Object.fromEntries(Object.entries(item as object).filter(([key]) => contentKeys.includes(key))),
          ),
        );
      const hashById = (item: any) => {
        const idValue = idKey ? item[idKey] : undefined;
        return idValue === undefined ? hashByContent(item) : idValue;
      };
      const currentById = groupBy(currentItems, hashById);
      const incomingById = groupBy(incomingItems, hashById);
      // If our local instance doesn't assign in id, when we get results back from the server, strip
      // their id and then see if we're the same based on data. Note that this is a hueristic, and will
      // fail if the client-side has made additional changes to the child after submitting it to the server,
      // or if the server acks back more/different data than the client sent.
      //
      // Only do this if one of our client-side objects is missing an id
      const incomingByContent =
        idKey && currentItems.some((item) => !(item as any)[idKey]) && groupBy(incomingItems, hashByContent);

      // Watch for deletions
      const hasOpKey = Object.keys(this._listConfig.config).includes("op");

      // First, process all current items
      for (const currentItem of currentItems) {
        const childState = this.getRow(currentItem)!; // We'll always have a child state for `currentItems`
        // Try to find a matching item in the incoming data
        const hash = hashById(currentItem);
        const match = (incomingById.get(hash)?.[0] ??
          // Only if we don't have `book[id]` set, look for a match based on our content
          (!!idKey &&
            !(currentItem as any)[idKey] &&
            !!incomingByContent &&
            // If we don't have an id, our `hash` variable will already be the `hashByContent`, so we can reuse it
            incomingByContent?.get(hash)?.[0])) as U | undefined;
        if (match) {
          // Defer to set to handle not nuking WIP changes
          childState.set(match, opts);
          mergedItems.push(childState.value);
          // Once matched, we don't want this to be an addedRow anymore
          this._addedRows.delete(currentItem);
        } else if (!childState.dirty && !childState.isNewEntity && !this._addedRows.has(currentItem)) {
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
          // If no incoming, but we're dirty (see above) and not deleted (see above), keep the WIP change
          mergedItems.push(currentItem);
        }
      }

      // Then, add any incoming items that don't exist in current
      //
      // Index the rows now, after the loop above has refreshed their ids
      const rowsById = this.indexRowsById();
      for (const incomingItem of incomingItems) {
        // Look for both `incoming.id` and the incoming-sans-id for new entities
        const match = currentById.get(hashById(incomingItem))?.[0] || currentById.get(hashByContent(incomingItem))?.[0];
        if (!match) {
          // New item from server, add it
          const childState = this.getOrCreateChildState(incomingItem, opts, rowsById);
          mergedItems.push(childState.value);
        }
      }

      parentInstance[key] = mergedItems as any as T[K];
      this._valueAtom.reportChanged();

      // Set original to not merged...
      this.setOriginalValue(incomingItems);
    } else {
      const rowsById = this.indexRowsById();
      parentInstance[key] = (values ?? []).map(
        (child) => this.getOrCreateChildState(child, opts, rowsById).value,
      ) as any as T[K];
      this._valueAtom.reportChanged();
      // Reset originalCopy so that our dirty checks have the right # of rows.
      if (opts.refreshing) {
        this.setOriginalValue();
      }
    }
  }

  add(value: U, spliceIndex?: number): void {
    // This is called by the user, so value should be a non-proxy value we should keep
    const childState = this.getOrCreateChildState(value) as ObjectStateInternal<U>;
    // Let `.set` know this is a new row
    this._addedRows.add(value);
    this.ensureSet();
    this.value.splice(typeof spliceIndex === "number" ? spliceIndex : this.value.length, 0, childState.value);
    this._valueAtom.reportChanged();
    this._requestAutoSave();
  }

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
    this._valueAtom.reportChanged();
    this._requestAutoSave();
  }

  revertChanges() {
    this.set(this.originalValue, { resetting: true });
    this.rows.forEach((r) => r.revertChanges());
    this.touched = false;
  }

  commitChanges() {
    // Tell each child ObjectState to have its fields commit into its parentCopy
    this.rows.forEach((r) => r.commitChanges());
    this.setOriginalValue();
    this.touched = false;
    this._valueAtom.reportChanged();
  }

  /** Disposes every row's ObjectState, including rows that were removed from the list. */
  dispose() {
    deactivateSubscriptions(this);
  }

  get originalValue(): U[] {
    this._originalValueAtom.reportObserved();
    const value = this._parentCopy[this._key];
    return value ?? ([] as any);
  }

  // This should only be called when value === originalValue
  setOriginalValue(incomingItems?: U[]) {
    const parentCopy = this._parentCopy;
    const key = this._key;
    // Use the rows' originalValues to update the parentCopy
    parentCopy[key] = incomingItems ?? (this.rows.map((r) => r.originalValue) as any);
    (parentCopy[key] as U[]).forEach((copy, i) => {
      this._copyMap.set(copy as object, (this._parentInstance[key] as any)[i]);
    });
    this._originalValueAtom.reportChanged();
  }

  ensureSet() {
    // Our callers, `add` and `remove`, report the change once they have spliced the list
    if (!this._parentInstance[this._key]) {
      (this._parentInstance as any)[this._key] = [];
    }
  }

  /**
   * Given a child POJO (or a copy/clone of a child POJO), return its ObjectState wrapper.
   *
   * Callers that resolve many children at once, i.e. `set`, pass the `rowsById` from `indexRowsById`
   * so that finding each child's existing row does not scan every row.
   */
  private getOrCreateChildState(
    child: U,
    opts?: InternalSetOpts & { skipSet?: boolean },
    rowsById?: RowsById<U>,
  ): ObjectState<U> {
    let childState = this.getRow(child);
    // If we're being reverted to our originalValue, i.e. values is actually
    // a list of copies, use the copyMap to recover the non-copy original value
    if (!childState && this._copyMap.has(child as object)) {
      childState = this.getRow(this._copyMap.get(child as object)!);
    }
    // Look for an existing child (requires having an id key configured)
    if (!childState) {
      const otherState = this.findSameEntity(child, rowsById);
      if (otherState) {
        // If we're being called from `list.rows`, we should be careful to not trigger mutations
        if (!opts?.skipSet) otherState.set(child, opts);
        this._aliases.set(child as object, otherState);
        return otherState;
      }
    }
    // If we didn't have an existing child, just make a new object state
    if (!childState) {
      childState = newObjectState<U>(
        this._config,
        this._parentState as any,
        undefined,
        this as any as FieldState<any>,
        child,
        undefined,
        this._requestAutoSave,
        // Note: this used to be `... ?? deepExhaustive`, but the left side is a boolean, so the
        // parent's `deepExhaustive` was never inherited here; this keeps that behavior.
        this._listConfig.update === "deep-exhaustive",
      ) as ObjectStateInternal<U>;
      this._rowMap.set(child, childState);
      // Let the rest of the caller's batch find this row, i.e. if a later child has the same id
      const id = rowsById && childState.idKey ? (child as any)[childState.idKey] : undefined;
      if (isIndexableId(id) && !rowsById!.has(id)) rowsById!.set(id, childState);
      if (subscriptionsActive(this)) activateSubscriptions(childState);
    }
    return childState;
  }

  /** Returns the ObjectState for `child`, whether it is a row's own instance or another instance of its entity. */
  private getRow(child: U): ObjectStateInternal<U> | undefined {
    return this._rowMap.get(child) ?? this._aliases.get(child as object);
  }

  /** Returns the existing row that is for the same entity as `child`, i.e. has the same id. */
  private findSameEntity(child: U, rowsById?: RowsById<U>): ObjectStateInternal<U> | undefined {
    // Prefer the index, but it only knows string and number ids
    if (rowsById) {
      const idKey = this._rowMap.values().next().value?.idKey;
      const id = idKey ? (child as any)[idKey] : undefined;
      // Without an id, `child` is a new entity, so cannot be the same as any row
      if (id === undefined) return undefined;
      if (isIndexableId(id)) return rowsById.get(id);
    }
    for (const otherState of this._rowMap.values()) {
      if (otherState.isSameEntity(child)) return otherState;
    }
    return undefined;
  }

  /**
   * Indexes the current rows by their id, so that `findSameEntity` is a lookup instead of a scan.
   *
   * Returns `undefined` if any row's id is not a string or number, i.e. a value object that
   * `isSameEntity` compares with `toJSON`, because a Map cannot do that comparison.
   *
   * Row ids can change, i.e. when a refresh assigns a new row its id, so build this right
   * before each batch of lookups, instead of keeping it.
   */
  private indexRowsById(): RowsById<U> | undefined {
    const rowsById: RowsById<U> = new Map();
    for (const row of this._rowMap.values()) {
      const id = row.idKey ? (row as any)[row.idKey].value : undefined;
      if (id === undefined || id === null) continue;
      if (!isIndexableId(id)) return undefined;
      // Keep the first row for an id, as that is the one a scan would find
      if (!rowsById.has(id)) rowsById.set(id, row);
    }
    return rowsById;
  }
}

/** The current rows of a list, by their string or number id. */
type RowsById<U> = Map<string | number, ObjectStateInternal<U>>;

/** Returns whether `id` can be a `RowsById` key, i.e. Map equality matches `isSameEntity` for it. */
function isIndexableId(id: unknown): id is string | number {
  return typeof id === "string" || typeof id === "number";
}

function hashValue(value: unknown): string {
  return hash(value as Parameters<typeof hash>[0]);
}
