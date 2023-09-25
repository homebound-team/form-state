// Create a Zod-style fluent DSL for building config
const c = {
  value<V>(): ValueConfig<V> {
    return null!;
  },
};

type Config<T> = { [P in keyof T]: ValueConfig<T[P]> };

function config<T>(object: Config<T>): void {}

// Allow fluent methods
interface ValueConfig<V> {
  req(): ValueConfig<V>;
  readOnly(): ValueConfig<V>;
  validate(fn: (value: V) => boolean): ValueConfig<V>;
}

// An pojo
type Author = { name: string; address: string; city: string };

// Try and configure the author
config<Author>({
  // correctly inferred as c.value<string> --> ValueConfig<string>
  name: c.value(),
  // inferred only as c.value<unknown> --> ValueConfig<unknown>
  address: c.value<string>().req(),
  // compile error, v is implicitly typed as any
  city: c.value<string>().validate((v) => v.length > 0),
});
