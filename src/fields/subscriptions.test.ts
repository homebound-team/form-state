import { getObserverTree, makeAutoObservable } from "mobx";
import type { ObjectConfig } from "src/config";
import { createInactiveObjectState, createObjectState } from "src/fields/objectField";
import { activateSubscriptions, deactivateSubscriptions } from "src/fields/subscriptions";

describe("subscriptions", () => {
  it("does not subscribe while building an inactive form tree", () => {
    // Given an observable nested object and a lazily created list row
    const nested = new Row("a:1");
    const child = new Row("a:2");

    // When a hook builds and reads the form before committing
    const form = createInactiveObjectState(treeConfig, { nested, children: [child] });
    expect(form.children.rows.length).toEqual(1);

    // Then reading the form has not acquired store subscriptions
    expect(getObserverTree(child, "name").observers ?? []).toEqual([]);
  });

  it("activates a field only once", () => {
    // Given an inactive form
    const row = new Row("a:1");
    const form = createInactiveObjectState(rowConfig, row);

    // When activation repeats
    activateSubscriptions(form);
    activateSubscriptions(form);

    // Then there is only one store reaction
    expect(getObserverTree(row, "name").observers?.length).toEqual(1);
    form.dispose();
  });

  it("disconnects nested object fields synchronously", () => {
    // Given an active tree containing a nested observable object
    const nested = new Row("a:1");
    const form = createObjectState(treeConfig, { nested, children: [] });

    // When the tree deactivates
    deactivateSubscriptions(form);

    // Then the nested object no longer retains its field reaction
    expect(getObserverTree(nested, "name").observers ?? []).toEqual([]);
  });

  it("disconnects removed rows retained in the list cache", () => {
    // Given a list row whose form remains cached after removal
    const child = new Row("a:2");
    const form = createObjectState(treeConfig, { nested: new Row("a:1"), children: [child] });
    expect(form.children.rows.length).toEqual(1);
    form.children.remove(0);

    // When the tree deactivates
    deactivateSubscriptions(form);

    // Then the removed row also releases its subscription
    expect(getObserverTree(child, "name").observers ?? []).toEqual([]);
  });

  it("connects a list row created while the tree is active", () => {
    // Given an active form with an initially empty list
    const child = new Row("a:2");
    const form = createObjectState(treeConfig, { nested: new Row("a:1"), children: [] });

    // When a lazy row is added
    form.children.add(child);

    // Then the row immediately inherits the active lifecycle
    expect(getObserverTree(child, "name").observers?.length).toEqual(1);
    form.dispose();
  });

  it("keeps lazy rows disconnected until the tree reactivates", () => {
    // Given a disconnected tree
    const child = new Row("a:2");
    const form = createObjectState(treeConfig, { nested: new Row("a:1"), children: [] });
    deactivateSubscriptions(form);
    // And a row is added while disconnected
    form.children.add(child);
    expect(getObserverTree(child, "name").observers ?? []).toEqual([]);

    // When the same tree reconnects
    activateSubscriptions(form);

    // Then the cached lazy row acquires its subscription
    expect(getObserverTree(child, "name").observers?.length).toEqual(1);
    form.dispose();
  });

  it("saves an observable change missed before activation", () => {
    // Given an inactive form whose original name is Bob
    const row = new Row("a:1");
    const saved: Partial<Row>[] = [];
    const form = createInactiveObjectState(rowConfig, row, {
      maybeAutoSave() {
        saved.push(form.changedValue);
      },
    });

    // When the source changes before subscriptions are acquired
    row.name = "Fred";
    activateSubscriptions(form);

    // Then activation saves the missed edit against the original baseline
    expect(saved).toEqual([{ id: "a:1", name: "Fred" }]);
    form.dispose();
  });

  it("reconnects the same cached row", () => {
    // Given an edited row in a disconnected tree
    const child = new Row("a:2");
    const form = createObjectState(treeConfig, { nested: new Row("a:1"), children: [child] });
    const rowForm = form.children.rows[0];
    rowForm.name.set("Fred");
    deactivateSubscriptions(form);

    // When the same tree reactivates
    activateSubscriptions(form);

    // Then reactivation has not replaced the row's form instance
    expect(form.children.rows[0]).toBe(rowForm);
    form.dispose();
  });
});

class Row {
  name = "Bob";

  constructor(public id: string) {
    makeAutoObservable(this);
  }
}

const rowConfig: ObjectConfig<Row> = { id: { type: "value" }, name: { type: "value" } };
const treeConfig: ObjectConfig<{ nested: Row; children: Row[] }> = {
  nested: { type: "object", config: rowConfig },
  children: { type: "list", config: rowConfig },
};
