export function fail(message?: string): never {
  throw new Error(message || "Failed");
}

export function assertNever(x: never): never {
  throw new Error("Unexpected object: " + x);
}
