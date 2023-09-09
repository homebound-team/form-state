/**
 * Creates a new combined object with keys in `overrides` taking precedence, and then
 * any other keys falling back to `delegate`.
 */
export function newDelegateProxy<T extends object, O extends object>(delegate: T, overrides: O): Omit<T, keyof O> & O {
  function pickTarget(key: keyof any) {
    return Reflect.has(overrides, key) ? overrides : delegate;
  }
  return new Proxy(delegate, {
    get(object, key) {
      return Reflect.get(pickTarget(key), key);
    },

    set(object, key, value) {
      return Reflect.set(pickTarget(key), key, value);
    },
  }) as any;
}
