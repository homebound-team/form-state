import { Fragment, ObjectState } from "src/fields/objectField";
import { Rule } from "src/rules";
import { Builtin } from "src/utils";

/**
 * Config rules for each field in `T` that we're editing in a form.
 *
 * Basically every field is either a value/primitive or a list, and this `ObjectConfig` lets
 * the caller define field-specific behavior, i.e. validation rules.
 */
export type ObjectConfig<T> = {
  // Right now ObjectState assumes every field (except functions) in T exists in the config
  // object, so this `keyof T` cannot be optional, i.e. we require a config for every field
  // on T. If we want to loosen this, then ObjectState needs to accept a generic that
  // is our config.
  //
  // We ignore functions (the OmitIf) to support observable classes that have
  // helper methods, i.e. `.toInput()`.
  [P in keyof OmitIf<T, Function>]: T[P] extends Fragment<infer V>
    ? FragmentFieldConfig
    : T[P] extends Array<infer U> | null | undefined
    ? U extends Builtin
      ? ValueFieldConfig<T, T[P]>
      : ListFieldConfig<T, U>
    : ValueFieldConfig<T, T[P]> | ObjectFieldConfig<T[P]>;
};

// Inverse of SubType: https://medium.com/dailyjs/typescript-create-a-condition-based-subset-types-9d902cea5b8c
type OmitIf<Base, Condition> = Pick<
  Base,
  {
    [Key in keyof Base]: Base[Key] extends Condition ? never : Key;
  }[keyof Base]
>;

/** Field configuration for an opaque value that we don't actually want to include. */
export type FragmentFieldConfig = {
  type: "fragment";
};

/** Field configuration for primitive values, i.e. strings/numbers/Dates/user-defined types. */
export type ValueFieldConfig<T, V> = {
  type: "value";
  rules?: Rule<V | null | undefined>[];
  /**
   * If true, marks this field as the id, which will be used for things like "always include in changedValue".
   *
   * Defaults to true for fields named `id`.
   */
  isIdKey?: boolean;
  /** If true, and this value is used on an entity in a list, the entity won't count towards the list validity. */
  isDeleteKey?: boolean;
  /** If true, the entity that contains this value will be treated as read only. */
  isReadOnlyKey?: boolean;
  /**
   * Marks a field as being backed by a mobx class computed field.
   *
   * Note that it might still be settable (some computed have setters), but we do
   * exclude from the `reset` operation, i.e. we assume resetting other non-computed fields
   * will effectively reset this field as well.
   */
  computed?: boolean;
  /** Marks a field as being initially read-only, i.e. `field.readOnly = true/false` can change this default. */
  readOnly?: boolean;
  /** Marks an array field to be order agnostic when determining changed/dirty states */
  strictOrder?: false;
};

/** Field configuration for list values, i.e. `U` is `Book` in a form with `books: Book[]`. */
export type ListFieldConfig<T, U> = {
  type: "list";
  /** Rules that can run on the full list of children. */
  rules?: Rule<readonly ObjectState<U>[]>[];
  /** Config for each child's form state, i.e. each book. */
  config: ObjectConfig<U>;
  /**
   * What the server-side update behavior is for this collection.
   *
   * When exhaustive, we include all rows in `changedValue` so that we
   * don't orhan unchanged rows.
   *
   * When incremental, we only include changed rows in `changedValue`.
   *
   * Defaults to `exhaustive` b/c that is the safest and also Joist's
   * default behavior.
   */
  update?: "exhaustive" | "incremental";
  /** Set to not consider the order of the list when evaluating changed/dirty states. */
  strictOrder?: false;
};

export type ObjectFieldConfig<U> = {
  type: "object";
  /** Config for the child's form state, i.e. each book. */
  config: ObjectConfig<U>;
};
