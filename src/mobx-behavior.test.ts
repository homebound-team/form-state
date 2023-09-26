import { autorun, observable, ObservableMap, runInAction } from "mobx";
import { ObservableObject } from "src/formState.test";

describe("mobx behavior", () => {
  it("mobx batches if in actions", () => {
    const a = observable({ name: "a1" });
    const b = observable({ name: "b1" });
    const map = new ObservableMap<string, { name: string }>();
    map.set("a", a);
    map.set("b", b);

    let runs = 0;
    autorun(() => {
      noop([...map.values()].filter((v) => v.name.includes("1")));
      runs++;
    });

    expect(runs).toBe(1);
    // When we change both a and b
    runInAction(() => {
      a.name = "a11";
      b.name = "b2";
    });
    // Then the reaction waited and only ran once
    expect(runs).toBe(2);
  });

  it("mobx can watch undefined keys", () => {
    const a = new ObservableObject();
    const b = new ObservableObject();
    const map = new ObservableMap<string, ObservableObject>();
    map.set("a", a);
    map.set("b", b);

    let runs = 0;
    autorun(() => {
      noop([...map.values()].map((a) => a.age));
      runs++;
    });

    expect(runs).toBe(1);
    b.age = 1;
    expect(runs).toBe(2);
  });

  it("mobx lists maintain observable identity", () => {
    // given a parent observable
    const a = observable({ list: [] as {}[] });
    // if we observable-ize a value being pushing it on the list
    const c1 = observable({});
    a.list.push(c1);
    // then we get identify equality on the list lookups
    expect(a.list[0] === c1).toEqual(true);
  });
});

function noop(t: unknown): void {}
