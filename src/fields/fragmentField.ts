import { createAtom, makeAutoObservable } from "mobx";
import { type FieldStateInternal } from "src/fields/valueField";

export interface FragmentField<V> {
  value: V;
}

export function newFragmentField<T extends object, K extends keyof T & string>(
  parentInstance: T,
  key: K,
): FragmentField<T[K]> {
  // `value` lives in a closure variable, not an observable, so we use an atom
  // to make `get value()` observable and `set value()` notify observers.
  const valueAtom = createAtom(`${key}.value`);

  // We steal the fragment from our parent, so that it doesn't
  // accidentally end up on the wire
  let value = parentInstance[key];
  delete parentInstance[key];

  const obj = {
    key,
    _isIdKey: false,
    _isDeleteKey: false,
    _isReadOnlyKey: false,
    _isLocalOnly: false,
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
      valueAtom.reportObserved();
      return value;
    },

    set value(v: T[K]) {
      value = v;
      valueAtom.reportChanged();
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
