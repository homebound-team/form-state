import { type Temporal } from "temporal-polyfill";

// Use Temporal's well-known tags for runtime detection instead of `instanceof` because this
// library can receive values from native Temporal, a polyfill, another copy of a polyfill,
// or another realm. Tag checks are stable across those boundaries, while `instanceof` is not.
const temporalPlainDateTag = "Temporal.PlainDate";
const temporalZonedDateTimeTag = "Temporal.ZonedDateTime";

// Narrow the supported Temporal surface area to the exact value types we want form-state to treat
// like builtins, so unsupported Temporal types still fall through to existing behavior.
type SupportedTemporalTag = typeof temporalPlainDateTag | typeof temporalZonedDateTimeTag;

export type SupportedTemporal = Temporal.PlainDate | Temporal.ZonedDateTime;

/** Detects the Temporal value types that form-state treats as builtins. */
export function isSupportedTemporal(value: unknown): value is SupportedTemporal {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<PropertyKey, unknown>;
  return (
    isSupportedTemporalTag(record[Symbol.toStringTag]) &&
    typeof record.equals === "function" &&
    typeof record.toJSON === "function"
  );
}

/** Compares supported Temporal values with Temporal's `.equals(...)` semantics. */
export function areSupportedTemporalValuesEqual(a: unknown, b: unknown): boolean | undefined {
  const aIsTemporal = isSupportedTemporal(a);
  const bIsTemporal = isSupportedTemporal(b);
  if (!aIsTemporal && !bIsTemporal) {
    return undefined;
  }
  if (!aIsTemporal || !bIsTemporal || a[Symbol.toStringTag] !== b[Symbol.toStringTag]) {
    return false;
  }
  return a.equals(b);
}

function isSupportedTemporalTag(value: unknown): value is SupportedTemporalTag {
  return value === temporalPlainDateTag || value === temporalZonedDateTimeTag;
}
