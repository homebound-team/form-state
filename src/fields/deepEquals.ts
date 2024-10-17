/**
 * Our own `deepEquals` because either `fast-deep-equals` or `dequal` or etc actually
 * handle cyclic data structures, despite ChatGTP's assertions/hallucinations.
 *
 * Ported from https://github.com/KoryNunn/cyclic-deep-equal which is ISC.
 */
export function deepEquals(a: any, b: any, visited: Set<any> = new Set()): boolean {
  const aType = typeof a;
  if (aType !== typeof b) return false;

  if (a == null || b == null || !(aType === "object" || aType === "function")) {
    if (aType === "number" && isNaN(a) && isNaN(b)) return true;
    return a === b;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aKeys = Object.keys(a),
    bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  let equal = true;

  for (const key of aKeys) {
    if (!(key in b)) {
      equal = false;
      break;
    }
    if (a[key] && a[key] instanceof Object) {
      if (visited.has(a[key])) break;
      visited.add(a[key]);
    }
    if (!deepEquals(a[key], b[key], visited)) {
      equal = false;
      break;
    }
  }

  return equal;
}
