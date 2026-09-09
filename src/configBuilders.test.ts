import { f } from "src/configBuilders";
import { required } from "src/rules";
// `import type` so that, with verbatimModuleSyntax, this does not also load (and re-register) formState.test's tests
import type { ObservableObject } from "src/formState.test";

describe("config", () => {
  it("keeps earlier rules when req is chained after rules", () => {
    // Given a value config with a custom rule
    // And `req()` is called after that rule was added
    const config = f.value<string>().rules([noBobs]).req().build();
    // Then both the custom rule and `required` are kept, in order
    expect(config.rules).toEqual([noBobs, required]);
  });

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
});

/** A test rule that rejects the value "bob". */
function noBobs(opts: { value: string | null | undefined }): string | undefined {
  return opts.value === "bob" ? "No bobs" : undefined;
}
