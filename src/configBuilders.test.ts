import { f } from "src/configBuilders";
import { ObservableObject } from "src/formState.test";

describe("config", () => {
  it("supports observable objects with helper methods in the config DSL", () => {
    const config = f.config<ObservableObject>({
      firstName: f.value(),
      lastName: f.value(),
      fullName: f.computed(),
    });
    // Throw away assertion, test is making sure ^ line compiles
    expect(config).toBeDefined();
  });

  it("supports nested objects", () => {
    const config = f.config({
      id: f.value(),
      address: f.object({ id: f.value() }),
    });
    expect(config).toMatchInlineSnapshot(`
      {
        "address": {
          "config": {
            "id": {
              "rules": [],
              "type": "value",
            },
          },
          "type": "object",
        },
        "id": {
          "rules": [],
          "type": "value",
        },
      }
    `);
  });

  it("supports Reference alias", () => {
    const config = f.config({
      id: f.value(),
      address: f.reference({ name: f.value() } as any),
    });
    expect(config).toMatchInlineSnapshot(`
      {
        "address": {
          "config": {
            "id": {
              "rules": [],
              "type": "value",
            },
            "name": {
              "rules": [],
              "type": "value",
            },
          },
          "reference": true,
          "type": "object",
        },
        "id": {
          "rules": [],
          "type": "value",
        },
      }
    `);
  });

  it("supports fragments", () => {
    const config = f.config({
      id: f.value(),
      address: f.fragment(),
    });
    expect(config).toMatchInlineSnapshot(`
      {
        "address": {
          "type": "fragment",
        },
        "id": {
          "rules": [],
          "type": "value",
        },
      }
    `);
  });
});
