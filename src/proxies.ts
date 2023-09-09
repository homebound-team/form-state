export function newDelegateProxy<T extends object, O extends object>(delegate: T, overrides: O): Omit<T, keyof O> & O {
  return new Proxy(delegate, {
    get(object, property) {
      if (Reflect.has(overrides, property)) {
        return Reflect.get(overrides, property);
      } else {
        return Reflect.get(delegate, property);
      }
    },

    set(object, property, value) {
      if (Reflect.has(overrides, property)) {
        return Reflect.set(overrides, property, value);
      } else {
        return Reflect.set(delegate, property, value);
      }
    },
  }) as any;
}
