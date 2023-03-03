import { action } from "mobx";

/** A validation rule, given the value and name, return the error string if valid, or undefined if valid. */
export type Rule<V> = (opts: { value: V; key: string; originalValue: V }) => string | undefined;

/** A rule that validates `value` is not `undefined`, `null`, or empty string. */
// We pre-emptively make this a mobx action so that it's identity doesn't change when proxied
// and breaks our ability to do `rules.some(r => r === required)`.
export const required = action(<V>({ value: v }: { value: V }): string | undefined => {
  const isEmptyString = typeof v === "string" ? v.trim() === "" : false;
  return v !== undefined && v !== null && !isEmptyString ? undefined : "Required";
});
