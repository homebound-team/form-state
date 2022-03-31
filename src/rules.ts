import { action } from "mobx";
import { ObjectState } from "src/fields/objectField";

// https://stackoverflow.com/questions/55541275/typescript-check-for-the-any-type
type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;

/** A validation rule, given the value and name, return the error string if valid, or undefined if valid. */
export type Rule<T, V> = (opts: {
  value: V;
  key: string;
  originalValue: V;
  // We need to pass `object` as the ObjectState, so that the rule is registered as an observer.
  // (The `IfAny` is because the `-?` in `FieldStates breaks the `any` type, see the "weirdness" test.)
  object: IfAny<T, any, ObjectState<T>>;
}) => string | undefined;

/** A rule that validates `value` is not `undefined`, `null`, or empty string. */
// We pre-emptively make this a mobx action so that it's identity doesn't change when proxied
// and breaks our ability to do `rules.some(r => r === required)`.
export const required = action(<V>({ value: v }: { value: V }): string | undefined => {
  const isEmptyString = typeof v === "string" ? v.trim() === "" : false;
  return v !== undefined && v !== null && !isEmptyString ? undefined : "Required";
});
