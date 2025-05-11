import { makeAutoObservable, observable } from "mobx";
import { FieldState, FieldStateInternal, ValueAdapter } from "src/fields/valueField";
import { fail } from "src/utils";
import { V } from "vite/dist/node/types.d-aGj9QkWt";

export interface FragmentField<V> {
  value: V;
}

export function newFragmentField<T extends object, K extends keyof T & string>(
  parentInstance: T,
  key: K,
): FragmentField<T[K]> {
  // We always return the same `instance` field from our `value` method, but
  // we want to pretend that it's observable, so use a tick to force it.
  const _tick = observable({ value: 1 });

  // We steal the fragment from our parent, so that it doesn't
  // accidentally end up on the wire
  let value = parentInstance[key];
  delete parentInstance[key];

  const obj = {
    key,
    _isIdKey: false,
    _isDeleteKey: false,
    _isReadOnlyKey: false,
    touched: false,
    valid: true,
    readOnly: true,
    required: false,
    loading: false,
    dirty: false,
    focused: false,
    originalValue: undefined,
    changedValue: undefined,
    errors: [],
    rules: [],
    isNewEntity: false,
    focus: () => {},
    blur: () => {},
    maybeAutoSave: () => {},
    commitChanges: () => {},
    revertChanges: () => {},

    get value() {
      // Watch for our parentInstance changing
      if (key in parentInstance) {
        value = parentInstance[key];
        delete parentInstance[key];
      }
      _tick.value > 0 || fail();
      return value;
    },

    set value(v: T[K]) {
      value = v;
      _tick.value++;
    },

    set(value) {
      this.value = value;
    },

    adapt(value) {
      throw new Error("FragmentField does not support adapt");
    },
  } satisfies FieldStateInternal<T, any>;

  return makeAutoObservable(obj, { value: false });
}
