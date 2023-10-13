import { FragmentFieldConfig, ListFieldConfig, ObjectConfig, ObjectFieldConfig, ValueFieldConfig } from "src/config";
import { Fragment, ObjectState } from "src/fields/objectField";
import { Rule, required } from "src/rules";
import { Builtin, OmitIf } from "src/utils";

/**
 * Provides a Zod-ish API for building form configs.
 */
export const f = {
  /** Creates the top-level config for a form, like an author or book. */
  config<T>(fields: ObjectConfigBuilderFields<T>): ObjectConfig<T> {
    return new ObjectConfigBuilder<T>(fields).build().config;
  },

  /** Creates the config DSL for an object, like an author or book. */
  object<T>(fields: ObjectConfigBuilderFields<T>): ObjectConfigBuilder<T> {
    return new ObjectConfigBuilder<T>(fields);
  },

  /** Creates the config DSL for an list of objects, like an author's list of books. */
  list<U>(fields: ObjectConfigBuilderFields<U>): ListFieldConfigBuilder<U> {
    return new ListFieldConfigBuilder<U>(fields);
  },

  /** Creates the config DSL for a primitive value, like a first name or phone number. */
  value<V>(): ValueFieldConfigBuilder<V> {
    return new ValueFieldConfigBuilder<V>();
  },

  /** A shortcut for creating a child object with a single `id` key. */
  reference<V extends { id?: unknown }>(fields?: ObjectConfigBuilderFields<V>): ObjectConfigBuilder<V> {
    return f.object<V>({ id: f.value(), ...fields } as any).ref();
  },

  /** A shorthand for creating a computed value. */
  computed<V>(): ValueFieldConfigBuilder<V> {
    return this.value().computed();
  },
};

/**
 * Defines the fields that should be passed into `f.object({ ... })` for fhe form type `T`.
 *
 * This is basically a map of `key` in `T` to `f.value()`, `f.list()`, or `f.object()`
 * DSL objects that define the runtime structure/fields of the form.
 */
export type ObjectConfigBuilderFields<T> = {
  [P in keyof OmitIf<T, Function>]: T[P] extends Fragment<infer V>
    ? FragmentFieldConfigBuilder
    : T[P] extends Array<infer U> | null | undefined
    ? U extends Builtin
      ? ValueFieldConfigBuilder<T[P]>
      : ListFieldConfigBuilder<U>
    : ValueFieldConfigBuilder<T[P]> | ObjectConfigBuilder<T[P]>;
};

export interface FragmentFieldConfigBuilder {
  build(): FragmentFieldConfig;
}

/** Provides a fluent DSL for building up an object's config. */
export class ObjectConfigBuilder<T> {
  private config: ObjectFieldConfig<T> = { type: "object", config: {} as ObjectConfig<T> };

  constructor(fields: ObjectConfigBuilderFields<T>) {
    for (const [key, value] of Object.entries(fields)) {
      (this.config.config as any)[key] = (value as any).build();
    }
  }

  ref(): this {
    this.config.reference = true;
    return this;
  }

  build(): ObjectFieldConfig<T> {
    return this.config;
  }
}

/** Provides a fluent DSL for building up a value's config. */
export class ValueFieldConfigBuilder<V> {
  private config: ValueFieldConfig<V> = { type: "value", rules: [] };

  /** Marks the field as required. */
  req(): this {
    this.config.rules = [required];
    return this;
  }

  /** Marks the field as read only. */
  readOnly(): this {
    this.config.readOnly = true;
    return this;
  }

  /** Appends `rules` to the field's validation rules. */
  rules(rules: Rule<V | null | undefined>[]): this {
    (this.config.rules ??= []).push(...rules);
    return this;
  }

  /** Marks the field as computed. */
  computed(): this {
    this.config.computed = true;
    return this;
  }

  build(): ValueFieldConfig<V> {
    return this.config;
  }
}

/** Provides a fluent DSL for building up a list's config. */
export class ListFieldConfigBuilder<U> {
  private config: ListFieldConfig<U>;

  constructor(fields: ObjectConfigBuilderFields<U>) {
    const config = {} as any;
    for (const [key, value] of Object.entries(fields)) {
      config[key] = (value as any).build();
    }
    this.config = { type: "list", rules: [], config };
  }

  /** Appends `rule` to the field's validation rules. */
  rule(rule: Rule<readonly ObjectState<U>[]>): this {
    (this.config.rules ??= []).push(rule);
    return this;
  }

  /** Appends `rules` to the field's validation rules. */
  rules(rules: Rule<readonly ObjectState<U>[]>[]): this {
    (this.config.rules ??= []).push(...rules);
    return this;
  }

  build(): ListFieldConfig<U> {
    return this.config;
  }
}
