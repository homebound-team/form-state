import { makeAutoObservable, observable } from "mobx";
import { fail } from "src/utils";

export interface FragmentField<V> {
  value: V;
}

export function newFragmentField<T, K extends keyof T>(parentInstance: T, key: K): FragmentField<T[K]> {
  // We always return the same `instance` field from our `value` method, but
  // we want to pretend that it's observable, so use a tick to force it.
  const _tick = observable({ value: 1 });

  // We steal the fragment from our parent, so that it doesn't
  // accidentally end up on the wire
  let value = parentInstance[key];
  delete parentInstance[key];

  const obj = {
    get value() {
      _tick.value > 0 || fail();
      return value;
    },

    set value(v: T[K]) {
      value = v;
      _tick.value++;
    },
  };

  return makeAutoObservable(obj, { value: false });
}
