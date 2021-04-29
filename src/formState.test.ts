import { autorun, isObservable, observable } from "mobx";
import { AuthorInput, BookInput, DateOnly, dd100, dd200, jan1, jan2 } from "src/formStateDomain";
import { createObjectState, ObjectConfig, pickFields, required } from "./formState";

describe("formState", () => {
  it("mobx lists maintain observable identity", () => {
    // given a parent observable
    const a = observable({ list: [] as {}[] });
    // if we observable-ize a value being pushing it on the list
    const c1 = observable({});
    a.list.push(c1);
    // then we get identify equality on the list lookups
    expect(a.list[0] === c1).toEqual(true);
  });

  it("can create a simple object", () => {
    const a = createObjectState<BookInput>({ title: { type: "value", rules: [required] } }, {});
    expect(a.valid).toBeFalsy();
  });

  it("can validate a simple input", () => {
    const a = createObjectState<BookInput>({ title: { type: "value", rules: [required] } }, { title: "b1" });
    let numErrors = 0;
    autorun(() => {
      numErrors = a.title.errors.length;
    });
    expect(a.valid).toBeTruthy();
    expect(numErrors).toEqual(0);
    a.title.value = null;
    expect(a.title.valid).toBeFalsy();
    expect(numErrors).toEqual(1);
  });

  it("can tell what is required", () => {
    const a = createObjectState<BookInput>(
      {
        title: { type: "value", rules: [required] },
        isPublished: { type: "value" },
      },
      {},
    );
    expect(a.title.required).toBeTruthy();
    expect(a.isPublished.required).toBeFalsy();
  });

  it("can set values", () => {
    const a = createObjectState<BookInput>({ title: { type: "value" } }, { title: "b1" });
    expect(a.title.value).toEqual("b1");
  });

  it("can read values", () => {
    const a = createObjectState<BookInput>({ title: { type: "value" } }, { title: "b1" });
    expect(a.value.title).toEqual("b1");
    expect(a.title.value).toEqual("b1");
  });

  it("can set dates", () => {
    const a = createObjectState<AuthorInput>(
      {
        birthday: {
          type: "value",
          rules: [(value) => (value?.getTime() === jan2.getTime() ? "cannot be born on jan2" : undefined)],
        },
      },
      { birthday: jan1 },
    );
    expect(a.birthday.value).toEqual(jan1);

    a.birthday.set(jan2);
    expect(a.birthday.errors).toEqual(["cannot be born on jan2"]);
  });

  it("can set nested values", () => {
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }],
    });
    expect(a1.books.rows[0].title.value).toEqual("b1");
  });

  it("can set nested values 2", () => {
    const a = createAuthorWithAddressInputState({ address: { city: "b1" } });
    expect(a.address.city.value).toEqual("b1");
  });

  it("maintains object identity", () => {
    const a1: AuthorInput = { firstName: "a1" };
    const state = createAuthorInputState(a1);
    state.firstName.set("a2");
    expect(state.originalValue === a1).toEqual(true);
    expect(a1.firstName).toEqual("a2");
  });

  it("maintains object identity of lists", () => {
    const b1: BookInput = { title: "t1" };
    const a1: AuthorInput = { firstName: "a1", books: [b1] };
    const state = createAuthorInputState(a1);
    const b2 = { title: "t2" };
    state.books.add(b2);
    expect(state.originalValue.books === a1.books).toEqual(true);
    expect(state.books.value.length).toEqual(2);
    expect(a1.books?.length).toEqual(2);
    expect(state.books.rows[0].originalValue === b1).toEqual(true);
    expect(state.books.rows[1].originalValue === b2).toEqual(true);
    expect(a1.books![1] === b2).toEqual(true);
  });

  it("can add items anywhere within a list", () => {
    const b1: BookInput = { title: "t1" };
    const a1: AuthorInput = { firstName: "a1", books: [b1] };
    const state = createAuthorInputState(a1);
    let numBooks: any;
    let ticks = 0;
    autorun(() => {
      numBooks = state.books.rows.length;
      ticks++;
    });

    const b2 = { title: "t2" };
    state.books.add(b2, 0);
    expect(state.books.rows[0].originalValue === b2).toEqual(true);
    expect(state.books.rows[1].originalValue === b1).toEqual(true);
    expect(ticks).toEqual(2);

    const b3 = { title: "t3" };
    state.books.add(b3, 1);
    expect(state.books.rows[0].originalValue === b2).toEqual(true);
    expect(state.books.rows[1].originalValue === b3).toEqual(true);
    expect(state.books.rows[2].originalValue === b1).toEqual(true);
    expect(ticks).toEqual(3);
  });

  it("maintains unknown fields", () => {
    // Given the form is not directly editing id fields
    const config: ObjectConfig<AuthorInput> = {
      firstName: { type: "value" },
      books: { type: "list", config: { title: { type: "value" } } },
    };
    // And we initially have ids in the input
    const a1: AuthorInput = { id: "1", firstName: "a1", books: [{ id: "2", title: "t1" }] };
    const state = createObjectState(config, a1);
    // And we edit a few things
    state.firstName.set("a2");
    state.books.add({ title: "t2" });
    // When we get back the originalValue
    const a2 = state.originalValue;
    // Then it has the ids and the new values
    expect(a2).toMatchObject({
      id: "1",
      books: [{ id: "2", title: "t1" }, { title: "t2" }],
    });
  });

  it("list field valid is based on nested fields", () => {
    // Given an author that is initially valid
    const a1 = createAuthorInputState({ firstName: "a1", books: [] });
    expect(a1.valid).toBeTruthy();
    let lastValid = undefined;
    let ticks = 0;
    autorun(() => {
      lastValid = a1.valid;
      ticks++;
    });
    // When an empty book is added
    a1.set({ firstName: "a1", books: [{}] });
    // Then it's title is invalid
    expect(a1.books.rows.length).toEqual(1);
    expect(a1.books.rows[0].title.valid).toBeFalsy();
    // And the books collection itself is invalid
    expect(a1.books.valid).toBeFalsy();
    // And the author itself is also invalid
    expect(a1.valid).toBeFalsy();
    expect(lastValid).toBeFalsy();
    expect(ticks).toEqual(2);

    // And when it becomes valid
    a1.books.rows[0].title.value = "b1";
    // Then everything is reactively valid
    expect(lastValid).toBeTruthy();
    expect(ticks).toEqual(3);
  });

  it("can add nested values", () => {
    // Given we already have a book
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }],
    });
    expect(a1.books.rows[0].title.value).toEqual("b1");
    // When another book is added
    a1.books.add({ title: "b2" });
    expect(a1.books.touched).toEqual(true);
    // Then both books are visible
    expect(a1.books.rows[0].title.value).toEqual("b1");
    expect(a1.books.rows[1].title.value).toEqual("b2");
  });

  it("can access nested values", () => {
    // Given we have two books
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }, { title: "b2" }],
    });
    // We can see what each book looks like
    expect(a1.books.value[0].title).toEqual("b1");
    expect(a1.books.value[1].title).toEqual("b2");
  });

  it("can remove nested values", () => {
    // Given we have two books
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }, { title: "b2" }],
    });
    expect(a1.books.rows[0].title.value).toEqual("b1");
    // When we remove the 1st book
    a1.books.remove(0);
    // Then only the 2nd book is left
    expect(a1.books.rows.length).toEqual(1);
    expect(a1.books.rows[0].title.value).toEqual("b2");
  });

  it("can remove non-first nested values", () => {
    // Given we have two books
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }, { title: "b2" }],
    });
    expect(a1.books.rows[0].title.value).toEqual("b1");
    // When we remove the 2nd book
    a1.books.remove(1);
    // Then only the 1st book is left
    expect(a1.books.rows.length).toEqual(1);
    expect(a1.books.rows[0].title.value).toEqual("b1");
  });

  it("can remove added nested values", () => {
    // Given we have a a single book
    const a1 = createAuthorInputState({ books: [{ title: "b1" }] });
    // And we push a new one
    a1.books.add({ title: "b2" });
    // When we remove the 2nd book by the row's reference value
    a1.books.remove(a1.books.rows[1].value);
    // Then only the 1st book is left
    expect(a1.books.rows.length).toEqual(1);
  });

  it("can remove non-first nested values by identity", () => {
    // Given we have two books
    const a1 = createAuthorInputState({
      firstName: "a1",
      books: [{ title: "b1" }, { title: "b2" }],
    });
    expect(a1.books.rows[0].title.value).toEqual("b1");
    // When we remove the 2nd book
    a1.books.remove(a1.books.value[1]);
    // Then only the 1st book is left
    expect(a1.books.rows.length).toEqual(1);
    expect(a1.books.rows[0].title.value).toEqual("b1");
  });

  it("can validate the nested collection directly", () => {
    // Given we already have a book
    const a1 = createAuthorInputState({ firstName: "a1", books: [] });
    let ticks = 0;
    let numErrors = 0;
    autorun(() => {
      numErrors = a1.books.errors.length;
      ticks++;
    });
    expect(ticks).toEqual(1);
    expect(numErrors).toEqual(0);

    a1.books.rules.push((b) => (b.length === 0 ? "Empty" : undefined));
    expect(a1.books.valid).toBeFalsy();
    expect(a1.books.errors).toEqual(["Empty"]);
    expect(ticks).toEqual(2);
    expect(numErrors).toEqual(1);

    a1.books.add({});
    expect(ticks).toEqual(3);
    expect(numErrors).toEqual(0);
  });

  it("can validate across fields", () => {
    const a = createObjectState<Omit<AuthorInput, "books">>(
      {
        firstName: { type: "value", rules: [] },
        lastName: { type: "value" },
      },
      {},
    );
    a.lastName.rules.push(() => {
      return a.firstName.value === a.lastName.value ? "Last name cannot be first name" : undefined;
    });

    a.firstName.value = "b1";
    expect(a.firstName.valid).toBeTruthy();
    expect(a.lastName.valid).toBeTruthy();
    a.lastName.value = "b1";
    expect(a.firstName.valid).toBeTruthy();
    expect(a.lastName.errors).toEqual(["Last name cannot be first name"]);
  });

  it("simple value changes trigger observers", () => {
    const a = createObjectState<BookInput>(
      {
        title: { type: "value", rules: [required] },
      },
      { title: "t2" },
    );
    let lastTitle: any = undefined;
    let ticks = 0;
    autorun(() => {
      lastTitle = a.title.value;
      ticks++;
    });
    expect(ticks).toEqual(1);
    expect(lastTitle).toEqual("t2");
  });

  it("knows value fields are dirty", () => {
    const a1 = createAuthorInputState({ firstName: "a1" });
    expect(a1.firstName.dirty).toBeFalsy();
    a1.firstName.set("a2");
    expect(a1.firstName.dirty).toBeTruthy();
    a1.firstName.set("a1");
    expect(a1.firstName.dirty).toBeFalsy();
  });

  it("knows value fields are dirty even if rendered before the initial set", () => {
    const a1 = createAuthorInputState({ firstName: "a1" });
    expect(a1.firstName.dirty).toBeFalsy();
    a1.firstName.set("a2");
    expect(a1.firstName.dirty).toBeTruthy();
    a1.firstName.set("a1");
    expect(a1.firstName.dirty).toBeFalsy();
  });

  it("knows nested value fields are dirty", () => {
    const a1 = createAuthorInputState({ books: [{ title: "t1" }] });
    expect(a1.books.rows[0].title.dirty).toBeFalsy();
    a1.books.rows[0].title.set("t2");
    expect(a1.books.rows[0].title.dirty).toBeTruthy();
    a1.books.rows[0].title.set("t1");
    expect(a1.books.rows[0].title.dirty).toBeFalsy();
  });

  it("knows list fields are dirty", () => {
    const a1 = createAuthorInputState({ books: [] });
    expect(a1.books.dirty).toBeFalsy();
    a1.books.add({ title: "t2" });
    expect(a1.books.dirty).toBeTruthy();
    a1.books.remove(0);
    expect(a1.dirty).toBeFalsy();
  });

  it("knows list of primitives are dirty", () => {
    const a1 = createObjectState<AuthorInput>({ favoriteColors: { type: "value" } }, {});
    expect(a1.favoriteColors.dirty).toBeFalsy();
    a1.favoriteColors.set(["blue"]);
    expect(a1.dirty).toBeTruthy();
    a1.favoriteColors.set(undefined!);
    expect(a1.dirty).toBeFalsy();
    // Because we were originally undefined, setting as `[]` coerces to `undefined`
    a1.favoriteColors.set([]);
    expect(a1.dirty).toBeFalsy();
  });

  it("knows list of primitives are dirty with initialized as empty list", () => {
    const a1 = createObjectState<AuthorInput>({ favoriteColors: { type: "value" } }, { favoriteColors: [] });
    expect(a1.favoriteColors.dirty).toBeFalsy();
    a1.favoriteColors.set(["blue"]);
    expect(a1.dirty).toBeTruthy();
    a1.favoriteColors.set([]);
    expect(a1.dirty).toBeFalsy();
    // Because we were originally undefined, setting as `[]` coerces to `undefined`
    a1.favoriteColors.set([]);
    expect(a1.dirty).toBeFalsy();
  });

  it("knows originally unset fields are dirty", () => {
    // Given firstName is purposefully not set when originally initialized
    const a1 = createAuthorInputState({});
    expect(a1.firstName.dirty).toBeFalsy();
    // When it is set
    a1.firstName.value = "a1";
    // Then it's dirty
    expect(a1.firstName.dirty).toBeTruthy();
    // And when it's set back to empty
    a1.firstName.value = undefined;
    // Then it's no longer dirty
    expect(a1.firstName.dirty).toBeFalsy();
  });

  it("knows strings set to empty string should be undefined", () => {
    const a1 = createAuthorInputState({ firstName: undefined });
    a1.firstName.value = "";
    expect(a1.firstName.value).toBeUndefined();
  });

  it("knows object fields are dirty", () => {
    const a1 = createAuthorInputState({ firstName: "a1" });
    expect(a1.dirty).toBeFalsy();
    a1.firstName.set("a2");
    expect(a1.dirty).toBeTruthy();
    a1.firstName.set("a1");
    expect(a1.dirty).toBeFalsy();
  });

  it("knows an object's field of type object is dirty", () => {
    const a1 = createAuthorInputState({
      books: [{ title: "b1", classification: dd100 }],
    });
    expect(a1.dirty).toBeFalsy();
    a1.books.rows[0].set({ classification: dd200 });
    expect(a1.dirty).toBeTruthy();
    a1.books.rows[0].set({ classification: dd100 });
    expect(a1.dirty).toBeFalsy();
  });

  it("resets values", () => {
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [
        { title: "b1", classification: dd100 },
        { title: "b2", classification: dd100 },
      ],
    });

    expect(a1.dirty).toBeFalsy();
    a1.firstName.set("a2");
    a1.firstName.touched = true;
    a1.lastName.set("aL2");
    a1.books.rows[0].set({ title: "b2" });
    a1.books.rows[1].set({ title: "bb2" });
    a1.books.add({ title: "b3" });
    expect(a1.books.touched).toEqual(true);
    expect(a1.dirty).toBeTruthy();
    a1.reset();
    expect(a1.firstName.value).toBe("a1");
    expect(a1.firstName.touched).toBeFalsy();
    expect(a1.lastName.value).toBe("aL1");
    expect(a1.books.rows.length).toBe(2);
    expect(a1.books.touched).toBe(false);
    expect(a1.books.rows[0].title.value).toBe("b1");
    expect(a1.books.rows[0].title.dirty).toBe(false);
    expect(a1.books.rows[0].title.touched).toBe(false);
    expect(a1.books.rows[1].title.value).toBe("b2");
    expect(a1.dirty).toBeFalsy();
    expect(a1.touched).toBeFalsy();
  });

  it("saves values into _originalState", () => {
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });
    expect(a1.dirty).toBeFalsy();

    // Now dirty things up.
    a1.firstName.set("a2");
    a1.lastName.set("aL2");
    a1.books.rows[0].set({ title: "b2" });
    a1.books.add({ title: "bb2" });
    // Set book 2 to an different value. Ensures our save can traverse all rows
    a1.books.rows[1].set({ title: "bb3" });

    // verify ValueFieldState is dirty, then save, then no longer dirty.
    expect(a1.firstName.dirty).toBeTruthy();
    a1.firstName.save();
    expect(a1.firstName.dirty).toBeFalsy();

    // verify ListFieldState is dirty, then save, then no longer dirty.
    expect(a1.books.dirty).toBeTruthy();
    a1.books.save();
    expect(a1.books.dirty).toBeFalsy();

    // Verify the remaining form is still dirty
    expect(a1.dirty).toBeTruthy();
    a1.save();
    // Verify after save the whole form is no longer dirty.
    expect(a1.dirty).toBeFalsy();
  });

  it("can touch everything at once", () => {
    const a1 = createAuthorInputState({ firstName: "a1", books: [{ title: "b1" }] });

    expect(a1.firstName.touched).toBeFalsy();
    expect(a1.books.touched).toBeFalsy();
    expect(a1.books.rows[0].title.touched).toBeFalsy();
    expect(a1.touched).toBeFalsy();

    a1.touched = true;
    expect(a1.firstName.touched).toBeTruthy();
    expect(a1.books.touched).toBeTruthy();
    expect(a1.books.rows[0].title.touched).toBeTruthy();
    expect(a1.touched).toBeTruthy();
  });

  it("remembers deleted values as null", () => {
    // Given a property that is initially set
    const a1 = createAuthorInputState({ firstName: "asdf" });
    // When it's set to an empty/undefined value
    a1.firstName.value = "";
    // Then we keep it as null
    expect(a1.firstName.value).toBeNull();
    expect(a1.originalValue.firstName).toBeNull();
    expect(a1.firstName.dirty).toBeTruthy();
  });

  it("initializes null values to be undefined", () => {
    // Given a property that is initially set to null
    const a1 = createAuthorInputState({ firstName: null });
    // Then expect it to be set to undefined
    expect(a1.firstName.value).toBeUndefined();
  });

  it("can keep initially undefined values as null", () => {
    // Given a property that is initially set
    const a1 = createAuthorInputState({ firstName: "foo" });
    // When we set it to null
    a1.firstName.value = null;
    // Then that isn't lost
    expect(a1.firstName.value).toBeNull();
    expect(a1.value.firstName).toBeNull();
  });

  it("can map properties to other types", () => {
    // Currently we muck with the input type outside of the object state DSL
    type Person = { firstName: string; lastName: string };
    type AuthorInputWithPerson = Exclude<AuthorInput, "firstName" | "lastName"> & { person: Person };
    const a1 = createObjectState<AuthorInputWithPerson>(
      {
        person: { type: "value" },
      },
      { person: { firstName: "a1", lastName: "b1" } },
    );
    a1.person.set({ firstName: "a2", lastName: "b2" });
    const inputWithPerson = a1.value;
    const { firstName, lastName } = inputWithPerson.person;
    const input: AuthorInput = { ...inputWithPerson, firstName, lastName };
    expect(input.firstName).toEqual("a2");
    expect(input.lastName).toEqual("b2");
  });

  it("has readonly", () => {
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });

    const fields = [a1, a1.firstName, a1.books, a1.books.rows[0].title, a1.books.rows[0].classification];
    fields.forEach((f) => expect(f.readOnly).toBeFalsy());

    a1.readOnly = true;
    fields.forEach((f) => expect(f.readOnly).toBeTruthy());
    fields.forEach((f) => {
      expect(() => f.set(null!)).toThrow("Currently readOnly");
    });
  });

  it("canSave returns dirty and touches", () => {
    const a1 = createObjectState<AuthorInput>(
      {
        firstName: { type: "value", rules: [required] },
      },
      {},
    );
    expect(a1.firstName.touched).toBeFalsy();
    expect(a1.canSave()).toBeFalsy();
    expect(a1.firstName.touched).toBeTruthy();
  });

  it("uses toJSON if available for dirty checks", () => {
    const a1 = createObjectState<{ birthday: DateOnly }>(
      {
        birthday: { type: "value" },
      },
      { birthday: new DateOnly(jan1) },
    );
    a1.birthday.set(new DateOnly(jan1));
    expect(a1.birthday.dirty).toBeFalsy();
  });

  it("can create a nested object", () => {
    const a = createAuthorWithAddressInputState({});
    expect(a.valid).toBeFalsy();
  });

  it("can validate a nested input", () => {
    const a = createAuthorWithAddressInputState({ address: { street: "b1" } });
    expect(a.valid).toBeTruthy();
  });

  it("can validate a list input", () => {
    const a = createObjectState<AuthorInput>(
      {
        books: {
          type: "list",
          config: { title: { type: "value", rules: [required] } },
          rules: [(value) => (value.find((b) => b.title.value === "t1") ? "Cannot have t1" : undefined)],
        },
      },
      {},
    );
    let lastErrors = "";
    autorun(() => {
      lastErrors = a.books.errors.join(", ");
    });
    a.books.add({ title: "t1" });
    expect(lastErrors).toEqual("Cannot have t1");
    a.books.rows[0].title.value = "t2";
    expect(lastErrors).toEqual("");
  });

  it("can ignore a deleted list entry", () => {
    const a = createObjectState<AuthorInput>(
      {
        books: {
          type: "list",
          config: {
            title: { type: "value", rules: [required] },
            delete: { type: "value", isDeleteKey: true },
          },
        },
      },
      {},
    );
    // Given we have a known-bad list entry
    a.books.add({ title: null, delete: false });
    // And are initially invalid
    expect(a.books.valid).toBeFalsy();
    // When the list entry is deleted
    a.books.rows[0].delete.value = true;
    // Then we're valid
    expect(a.books.valid).toBeTruthy();
  });

  it("can treat a list entry as read-only", () => {
    const a = createObjectState<AuthorInput>(
      {
        books: {
          type: "list",
          config: {
            title: { type: "value", rules: [required] },
            isPublished: { type: "value", isReadOnlyKey: true },
          },
        },
      },
      {},
    );
    // Given we have a published book
    a.books.add({ title: null, isPublished: true });
    // And an unpublished book
    a.books.add({ title: null, isPublished: false });
    // And we currently depend on the form.readOnly being invoked
    a.readOnly = false;
    // Then the 1st one is read only
    expect(a.books.rows[0].readOnly).toBeTruthy();
    expect(a.books.rows[0].title.readOnly).toBeTruthy();
    // And the 2nd one is not
    expect(a.books.rows[1].readOnly).toBeFalsy();
    expect(a.books.rows[1].title.readOnly).toBeFalsy();
    // And reset does not blow up
    a.reset();
  });

  it("can set nested values when original null", () => {
    const a = createAuthorWithAddressInputState({ address: null });
    a.address.city.value = "b1";
    expect(a.address.city.value).toEqual("b1");
    expect(a.address.value).toMatchInlineSnapshot(`
      Object {
        "city": "b1",
      }
    `);
    expect(a.value).toMatchInlineSnapshot(`
      Object {
        "address": Object {
          "city": "b1",
        },
      }
    `);
  });

  it("can pick a value field", () => {
    const a = pickFields(
      //
      { firstName: { type: "value" } },
      { firstName: "a", b: "ignored" },
    );
    expect(a).toMatchInlineSnapshot(`
      Object {
        "firstName": "a",
      }
    `);
  });

  it("can pick an unset object fields", () => {
    const a = pickFields(authorWithAddressConfig, { firstName: "a", b: "ignored" });
    expect(a).toMatchInlineSnapshot(`
      Object {
        "address": undefined,
        "firstName": "a",
        "lastName": undefined,
      }
    `);
  });

  it("can pick a set object field", () => {
    const a = pickFields(authorWithAddressConfig, { firstName: "a", b: "ignored", address: {} });
    expect(a).toMatchInlineSnapshot(`
      Object {
        "address": Object {
          "city": undefined,
          "street": undefined,
        },
        "firstName": "a",
        "lastName": undefined,
      }
    `);
  });

  it("can pick an unset list field", () => {
    const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored" });
    expect(a).toMatchInlineSnapshot(`
      Object {
        "books": undefined,
        "firstName": "a",
        "lastName": undefined,
      }
    `);
  });

  it("can pick a set list field", () => {
    const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored", books: [{}] });
    expect(a).toMatchInlineSnapshot(`
      Object {
        "books": Array [
          Object {
            "classification": undefined,
            "title": undefined,
          },
        ],
        "firstName": "a",
        "lastName": undefined,
      }
    `);
  });

  it("can pick a set observable list field", () => {
    const books = observable([] as BookInput[]);
    const a = pickFields(authorWithBooksConfig, { firstName: "a", b: "ignored", books });
    expect(isObservable(a.books)).toEqual(true);
  });

  it("can wrap an existing list observable", () => {
    // Given an array observable that is already created
    const b1: BookInput = { title: "b1" };
    const books = observable([b1]);
    // When we create a form state around it
    const formState = createAuthorInputState({ books });
    // Then the initial book was copied over
    let lastLength = 0;
    autorun(() => {
      lastLength = formState.books.rows.length;
    });
    expect(lastLength).toEqual(1);
    // And when we add a new book to the original observable
    books.push({ title: "b2" });
    // Then the formState saw it
    expect(lastLength).toEqual(2);
  });

  it("supports observable objects with helper methods", () => {
    const config: ObjectConfig<ObservableObject> = {
      firstName: { type: "value" },
      lastName: { type: "value" },
      fullName: { type: "value", computed: true },
    };
    // Throw away assertion, test is making sure ^ line compiles
    expect(config).toBeDefined();
  });

  it("can reset observable objects with computeds", () => {
    const formState = createObjectState(
      {
        firstName: { type: "value" },
        lastName: { type: "value" },
        fullName: { type: "value", computed: true },
      },
      new ObservableObject(),
    );
    expect(formState.firstName.value).toEqual("first");
    formState.firstName.value = "change";
    formState.reset();
    expect(formState.firstName.value).toEqual("first");
  });

  it("can set computeds that have setters", () => {
    const formState = createObjectState(
      {
        firstName: { type: "value" },
        lastName: { type: "value" },
        fullName: { type: "value", computed: true },
      },
      new ObservableObject(),
    );
    formState.fullName.value = "Bob Smith";
    expect(formState.firstName.value).toEqual("Bob");
    formState.fullName.set("Fred Smith");
    expect(formState.firstName.value).toEqual("Fred");
    formState.reset();
    expect(formState.firstName.value).toEqual("first");
  });
});

class ObservableObject {
  firstName: string = "first";
  lastName: string = "last";

  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  }

  set fullName(fullName: string) {
    const parts = fullName.split(" ");
    this.firstName = parts[0];
    this.lastName = parts[1];
  }

  toInput(): { firstName: string } {
    return { firstName: this.firstName };
  }
}

const authorWithBooksConfig: ObjectConfig<AuthorInput> = {
  firstName: { type: "value" },
  lastName: { type: "value" },
  books: {
    type: "list",
    config: {
      title: { type: "value", rules: [required] },
      classification: { type: "value" },
    },
  },
};

function createAuthorInputState(input: AuthorInput) {
  return createObjectState<AuthorInput>(authorWithBooksConfig, input);
}

const authorWithAddressConfig: ObjectConfig<AuthorInput> = {
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

function createAuthorWithAddressInputState(input: AuthorInput) {
  return createObjectState<AuthorInput>(authorWithAddressConfig, input);
}
