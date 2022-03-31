import { computed, makeAutoObservable, observable } from "mobx";
import { ListFieldConfig, ObjectConfig } from "src/config";
import { createObjectState, newObjectState, ObjectState, ObjectStateInternal } from "src/fields/objectField";
import { FieldState, InternalSetOpts } from "src/fields/valueField";
import { required, Rule } from "src/rules";
import { fail, isNotUndefined } from "src/utils";

/** Form state for list of children, i.e. `U` is a `Book` in a form with a `books: Book[]`. */
export interface ListFieldState<T, U> extends Omit<FieldState<T, U[]>, "originalValue"> {
  readonly rows: ReadonlyArray<ObjectState<U>>;

  add(value: U, index?: number): void;

  remove(indexOrValue: number | U): void;
}

export function newListFieldState<T, K extends keyof T, U>(
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
