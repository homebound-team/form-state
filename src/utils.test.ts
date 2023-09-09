import { isObservable, observable } from "mobx";
import { ObjectConfig } from "src/config";
import { AuthorInput, BookInput } from "src/formStateDomain";
import { required } from "src/rules";
import { pickFields } from "src/utils";

describe("utils", () => {
  describe("pickFields", () => {
    it("can pick a value field", () => {
      const a = pickFields(
        //
        { firstName: { type: "value" } },
        { firstName: "a", b: "ignored" },
      );
      expect(a).toMatchInlineSnapshot(`
        {
          "firstName": "a",
        }
      `);
    });

    it("can pick an unset object fields", () => {
      const a = pickFields(authorWithAddressConfig, { firstName: "a", b: "ignored" });
      expect(a).toMatchInlineSnapshot(`
        {
          "address": undefined,
          "firstName": "a",
          "id": undefined,
          "lastName": undefined,
        }
      `);
    });

    it("can pick a set object field", () => {
      const a = pickFields(authorWithAddressConfig, { firstName: "a", b: "ignored", address: {} });
      expect(a).toMatchInlineSnapshot(`
        {
          "address": {
            "city": undefined,
            "street": undefined,
          },
          "firstName": "a",
          "id": undefined,
          "lastName": undefined,
        }
      `);
    });

    it("can pick an unset list field", () => {
      const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored" });
      expect(a).toMatchInlineSnapshot(`
        {
          "books": undefined,
          "firstName": "a",
          "id": undefined,
          "lastName": undefined,
        }
      `);
    });

    it("can pick a set list field", () => {
      const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored", books: [{}] });
      expect(a).toMatchInlineSnapshot(`
        {
          "books": [
            {
              "classification": undefined,
              "id": undefined,
              "title": undefined,
            },
          ],
          "firstName": "a",
          "id": undefined,
          "lastName": undefined,
        }
      `);
    });

    it("can pick a set observable list field", () => {
      const books = observable([] as BookInput[]);
      const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored", books });
      expect(isObservable(a.books)).toEqual(true);
    });
  });
});

const authorWithAddressConfig: ObjectConfig<AuthorInput> = {
  id: { type: "value" },
  firstName: { type: "value" },
  lastName: { type: "value" },
  address: {
    type: "object",
    config: {
      street: { type: "value", rules: [required] },
      city: { type: "value" },
    },
  },
};

const authorWithBooksConfig: ObjectConfig<AuthorInput> = {
  id: { type: "value" },
  firstName: { type: "value" },
  lastName: { type: "value" },
  books: {
    type: "list",
    config: {
      id: { type: "value" },
      title: { type: "value", rules: [required] },
      classification: { type: "value" },
    },
  },
};
