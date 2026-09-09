import { deepEquals } from "src/fields/deepEquals";

describe("deepEquals", () => {
  it("keeps comparing keys after a repeated shared reference", () => {
    // Given a sub-object that appears twice in each parent
    const shared = { n: 1 };
    // And the parents differ only in a key that comes after the second reference
    const a = { x: shared, y: shared, z: 1 };
    const b = { x: shared, y: shared, z: 2 };
    // Then the second `shared` visit does not stop the comparison, so `z` is still compared
    expect(deepEquals(a, b)).toBe(false);
  });

  it("keeps comparing array entries after a repeated shared reference", () => {
    // Given an entry that appears twice in each array
    const shared = { n: 1 };
    // And the arrays differ only in an entry that comes after the second reference
    expect(deepEquals([shared, shared, { n: 1 }], [shared, shared, { n: 2 }])).toBe(false);
  });

  it("still treats equal cyclic structures as equal", () => {
    // Given two structures that each point back at themselves
    const a: any = { n: 1 };
    a.self = a;
    const b: any = { n: 1 };
    b.self = b;
    expect(deepEquals(a, b)).toBe(true);
  });
});
