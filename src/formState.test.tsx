import { autorun, makeAutoObservable, observable, reaction } from "mobx";
import { AuthorAddress, AuthorInput, BookInput, Color, DateOnly, dd100, dd200, jan1, jan2 } from "src/formStateDomain";
import { createObjectState, FieldState, ObjectConfig, ObjectState, required } from "./formState";

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
    const a: ObjectState<BookInput> = createObjectState<BookInput>(
      { title: { type: "value", rules: [required] } },
      { title: "b1" },
    );
    let numErrors = 0;
    autorun(() => {
      numErrors = a.title.errors.length;
    });
    expect(a.valid).toBeTruthy();
    expect(numErrors).toEqual(0);
    a.title.value = null;
    expect(a.title.valid).toBeFalsy();
    expect(numErrors).toEqual(1);
    expect(a.title.errors).toEqual(["Required"]);
    expect(a.errors).toEqual(["title: Required"]);
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
          rules: [({ value }) => (value?.getTime() === jan2.getTime() ? "cannot be born on jan2" : undefined)],
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

  it("list value can observe changes", () => {
    const b1: BookInput = { title: "t1" };
    const a1: AuthorInput = { firstName: "a1", books: [b1] };
    const state = createAuthorInputState(a1);
    let books: any;
    let ticks = 0;
    autorun(() => {
      books = state.books.value;
      ticks++;
    });
    state.books.add({ title: "t2" }, 0);
    expect(ticks).toEqual(2);
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
    expect(a1.books.rows[0].title.errors).toEqual(["Required"]);
    // And the books collection itself is invalid
    expect(a1.books.valid).toBeFalsy();
    // But we don't currently show the error here b/c it's not an error on the collection itself;
    // we could have like an `a1.books.allErrors` property instead.
    expect(a1.books.errors).toEqual([]);
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

    a1.books.rules.push(({ value: b }) => (b.length === 0 ? "Empty" : undefined));
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

  it("calls onBlur when adding or removing to a list", () => {
    const onBlur = jest.fn();
    const a1 = createAuthorInputState({ books: [] }, onBlur);
    expect(a1.books.dirty).toBeFalsy();
    a1.books.add({ title: "t2" });
    expect(a1.books.dirty).toBeTruthy();
    a1.books.remove(0);
    expect(a1.dirty).toBeFalsy();
    expect(onBlur).toBeCalledTimes(2);
  });

  it("calls onBlur when programmatically setting a value", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, onBlur);
    // When we programmatically set a field that isn't focused
    a1.firstName.value = "first";
    // Then we call onBlur
    expect(onBlur).toBeCalledTimes(1);
    // And when we set a nested value
    a1.books.rows[0].title.value = "title";
    // Then we called onBlur again
    expect(onBlur).toBeCalledTimes(2);
  });

  it("can skip onBlur when programmatically setting a value", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, onBlur);
    // When we programmatically set a field that isn't focused
    a1.set({ firstName: "first" }, { autoSave: false });
    // Then we don't call onBlur
    expect(onBlur).toBeCalledTimes(0);
  });

  it("defers calling onBlur when setting a bound value", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, onBlur);
    // And the field is focused
    a1.firstName.focus();
    // When we we set the field
    a1.firstName.value = "first";
    // Then we don't call onBlur
    expect(onBlur).toBeCalledTimes(0);
  });

  it("skips onBlur when refreshing", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, onBlur);
    // When we programmatically set a field that isn't focused
    (a1 as any).set({ firstName: "first" }, { refreshing: true });
    // Then we don't call onBlur
    expect(onBlur).toBeCalledTimes(0);
  });

  it("skips onBlur when resetting", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, onBlur);
    // And we called onBlur once
    a1.set({ firstName: "first" });
    expect(onBlur).toBeCalledTimes(1);
    // When we reset
    a1.reset();
    // We don't call blur again
    expect(onBlur).toBeCalledTimes(1);
  });

  it("skips onBlur when not dirty", () => {
    const onBlur = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ firstName: "first", books: [{}] }, onBlur);
    // When we programmatically set a field to it's existing valued
    a1.firstName.value = "first";
    // Then we don't call onBlur
    expect(onBlur).toBeCalledTimes(0);
  });

  it("knows list of primitives are dirty", () => {
    const a1 = createObjectState<AuthorInput>({ favoriteColors: { type: "value" } }, {});
    expect(a1.favoriteColors.dirty).toBeFalsy();
    a1.favoriteColors.set([Color.Blue]);
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
    a1.favoriteColors.set([Color.Blue]);
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

  it("resets values even if read only", () => {
    // Given a form state
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [
        { title: "b1", classification: dd100 },
        { title: "b2", classification: dd100 },
      ],
    });
    // And some values have been changed
    expect(a1.dirty).toBeFalsy();
    a1.firstName.set("a2");
    a1.firstName.touched = true;
    a1.lastName.set("aL2");
    a1.books.rows[0].set({ title: "b2" });
    a1.books.rows[1].set({ title: "bb2" });
    a1.books.add({ title: "b3" });
    expect(a1.books.touched).toEqual(true);
    expect(a1.dirty).toBeTruthy();
    // And the "readOnly=true" operation has "beat" the reset operation
    a1.readOnly = true;
    // When we reset
    a1.reset();
    // Then it still works
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
      expect(() => f.set(null!)).toThrow("is currently readOnly");
    });
  });

  it("maintain field readOnly state when form is readOnly", () => {
    // Given a formState
    const formState = createObjectState<BookInput>({ title: { type: "value", rules: [required], readOnly: true } }, {});

    // Then expect form
    expect(formState.title.readOnly).toBeTruthy();
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
          rules: [({ value }) => (value.find((b) => b.title.value === "t1") ? "Cannot have t1" : undefined)],
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
    expect(formState.fullName.value).toEqual("first last");

    formState.firstName.value = "change";
    expect(formState.fullName.value).toEqual("change last");

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

  it("can mark fields as read only", () => {
    const formState = createObjectState(
      {
        firstName: { type: "value" },
        lastName: { type: "value" },
        fullName: { type: "value", readOnly: true },
      },
      new ObservableObject(),
    );

    expect(formState.fullName.value).toEqual("first last");
    expect(formState.fullName.readOnly).toEqual(true);

    formState.firstName.value = "change";
    expect(formState.fullName.value).toEqual("change last");

    formState.reset();
    expect(formState.firstName.value).toEqual("first");
  });

  it("lets rules validate against other fields", () => {
    const formState = createObjectState<AuthorInput>(
      {
        firstName: { type: "value", rules: [] },
        lastName: {
          type: "value",
          rules: [
            ({ object }) => {
              if (object.firstName.value === object.lastName.value) {
                return "Must not match first name";
              }
            },
          ],
        },
      },
      {},
    );
    formState.firstName.value = "bob";
    formState.lastName.value = "bob";
    expect(formState.lastName.errors).toEqual(["Must not match first name"]);
  });

  it("can return only changed primitive fields", () => {
    // Given an author
    const formState = createObjectState(authorWithBooksConfig, {
      id: "a:1",
      firstName: "f",
      lastName: "l",
      books: [{ title: "t1" }],
    });
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we change the last name
    formState.lastName.value = "l2";
    // Then only the id (for updates) and last name are in changed value
    expect(formState.changedValue).toEqual({
      id: "a:1",
      lastName: "l2",
    });
  });

  it("can return only changed object fields", () => {
    // Given an author with an address object
    const formState = createObjectState(authorWithAddressConfig, {
      id: "a:1",
      firstName: "f",
      address: { city: "c1", street: "s1" },
    });
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we change the sub object
    formState.address.street.value = "s2";
    // Then we get the author id (for update) and only what changed in the address
    expect(formState.changedValue).toEqual({
      id: "a:1",
      address: { street: "s2" },
    });
  });

  it("changedValue skips empty nested fields", () => {
    // Given a new author with an address object
    const formState = createObjectState(authorWithAddressConfig, {
      firstName: "f",
      // And nothing is in the address
      address: {},
    });
    // Then we don't include an empty address in the output,
    // because this might trigger creating a throw-away entity
    expect(formState.changedValue).toEqual({ firstName: "f" });
  });

  it("changedValue skips effectively empty nested fields", () => {
    // Given a new author with an address object
    const formState = createObjectState(authorWithAddressConfig, {
      firstName: "f",
      // And only undefined keys are in the address
      address: { city: undefined },
    });
    // Then we don't include an empty address in the output,
    // because this might trigger creating a throw-away entity
    expect(formState.changedValue).toEqual({ firstName: "f" });
  });

  it("can return only changed list fields", () => {
    // Given an author with some books
    const formState = createObjectState(authorWithBooksConfig, {
      id: "a:1",
      firstName: "f",
      books: [
        { id: "b:1", title: "t1" },
        { id: "b:2", title: "t2" },
      ],
    });
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we change the 1st book
    formState.books.rows[0].title.value = "t1b";
    // Then we get the author id (for updates) and both books b/c `author.books = [...]` is
    // assumed to be an exhaustive set and we don't want to orphan the 2nd book.
    expect(formState.changedValue).toEqual({
      id: "a:1",
      books: [{ id: "b:1", title: "t1b" }, { id: "b:2" }],
    });
  });

  it("can return only changed but incremental list fields", () => {
    // Given an author
    const formState = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        // And the books collection is marked as incremental (i.e. line items)
        books: {
          type: "list",
          update: "incremental",
          config: {
            id: { type: "value" },
            title: { type: "value", rules: [required] },
          },
        },
      },
      {
        id: "a:1",
        firstName: "f",
        books: [
          { id: "b:1", title: "t1" },
          { id: "b:2", title: "t2" },
        ],
      },
    );
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we change the 1st book
    formState.books.rows[0].title.value = "t1b";
    // Then only the 1st book is included
    expect(formState.changedValue).toEqual({
      id: "a:1",
      books: [{ id: "b:1", title: "t1b" }],
    });
  });

  it("can observe value changes", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f" });
    let ticks = 0;
    reaction(
      () => formState.value,
      () => ticks++,
      { equals: () => false },
    );
    expect(ticks).toEqual(0);
    formState.firstName.value = "f";
    expect(ticks).toEqual(0);
    formState.firstName.value = "f2";
    expect(ticks).toEqual(1);
  });

  it("does not override a focused, changed field", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f", lastName: "l" });
    // Given first name is focused
    formState.firstName.focus();
    // And they have wip edits
    formState.firstName.set("ff");
    // When a mutation result sets both firstName and lastName
    (formState as any).set({ firstName: "f2", lastName: "l2" }, { refreshing: true });
    // Then we don't overwrite the user's WIP work
    expect(formState.firstName.value).toEqual("ff");
    expect(formState.lastName.value).toEqual("l2");
    // But the user can still actively type a value
    formState.firstName.set("fff");
    expect(formState.firstName.value).toEqual("fff");
  });

  it("does update a focused, unchanged field", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f", lastName: "l" });
    // Given first name is focused, but has not changed
    formState.firstName.focus();
    // When a mutation result sets both firstName and lastName
    (formState as any).set({ firstName: "f2", lastName: "l2" }, { refreshing: true });
    // Then we do update the value
    expect(formState.firstName.value).toEqual("f2");
  });

  it("trims string values on blur", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f", lastName: "l" });
    // Given the user is typing with spaces
    formState.firstName.focus();
    formState.firstName.set("f ");
    // And we initially keep the space
    expect(formState.firstName.value).toEqual("f ");
    // When the field is blurred
    formState.firstName.blur();
    // Then we trim it
    expect(formState.firstName.value).toEqual("f");
  });

  it("trims empty values to undefined on blur", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f", lastName: "l" });
    // Given the user is typing with only spaces
    formState.firstName.focus();
    formState.firstName.set(" ");
    // And we initially keep the space
    expect(formState.firstName.value).toEqual(" ");
    // When the field is blurred
    formState.firstName.blur();
    // Then we trim it to null (b/c the firstName was originally set)
    expect(formState.firstName.value).toEqual(null);
  });

  it("reproduces the type modifier weirdness", () => {
    // Adding/removing `-?` makes the `anyCallback` line flip between broken/working
    type Mapped<T> = { [K in keyof T]-?: number };
    type Callback<T> = (object: Mapped<T>) => void;
    const fn: Callback<{ firstName: string }> = () => {};
    // @ts-expect-error
    const anyCallback: Callback<any> = fn;
  });

  it("can work with both required inputs and optional fields", () => {
    // Given an input where `id` is required
    type AuthorInput = {
      id: string;
      // And firstName is optional
      firstName?: string | null;
    };
    // And we drop it in a form.
    const form = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        firstName: { type: "value" },
      },
      { id: "a:1" },
    );
    // id should not accept null/undefined
    // @ts-expect-error
    form.id.set(undefined);
    // A BoundField typically has `string | undefined | null` so works on firstName
    let field1: FieldState<AuthorInput, string | undefined | null>;
    field1 = form.firstName;
    // But not on id
    // @ts-expect-error
    field1 = form.id;
    // And same thing with any as the object type
    let field2: FieldState<any, string | undefined | null>;
    field2 = form.firstName;
    // @ts-expect-error
    field2 = form.id;
  });

  it("can have child object states passed in as field states", () => {
    // Given an author
    const a = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        // And address is modeled as a value object
        address: { type: "value" },
      },
      {},
    );
    // And a bound field that wants a FieldState<any, Address> (even though technically `ObjectState`
    // turns this into a nested `ObjectState` (instead of "just a `FieldState`"), because it can't
    // "see" the `{ type: value }`, until we pass the config as a generic to `ObjectState`.
    let field: FieldState<any, AuthorAddress | null | undefined>;
    // Then we can assign the value
    field = a.address;
    // And treat it as a value object
    a.address.set({ street: "123", city: "nyc" });
    expect(a.value).toEqual({ address: { street: "123", city: "nyc" } });
  });

  it("provides isNewEntity", () => {
    // Given an author without an id
    const formState = createObjectState(authorWithAddressConfig, {
      firstName: "f",
      address: { city: "c1", street: "s1" },
    });
    // Then their fields know the entity is new
    expect(formState.firstName.isNewEntity).toBeTruthy();
    expect(formState.address.city.isNewEntity).toBeTruthy();
    // When we have an id
    formState.id.set("1");
    // Then their fields know the entity is not new
    expect(formState.firstName.isNewEntity).toBeFalsy();
    expect(formState.address.city.isNewEntity).toBeFalsy();
  });

  it("isNewEntity is false if there is no id field", () => {
    // Given an author without an id field defined
    const formState = createObjectState<AuthorInput>(
      {
        firstName: { type: "value" },
        address: { type: "object", config: { street: { type: "value" } } },
      },
      {},
    );
    // Then their fields don't think the entity is new
    expect(formState.firstName.isNewEntity).toBeFalsy();
    expect(formState.address.street.isNewEntity).toBeFalsy();
  });

  it("provides isNewEntity for lists", () => {
    // Given an author & books without an id
    const formState = createObjectState(authorWithBooksConfig, {
      books: [{ title: "t1" }, { title: "t2" }],
    });
    // Then both books know they are new
    expect(formState.books.rows[0].title.isNewEntity).toBeTruthy();
    expect(formState.books.rows[1].title.isNewEntity).toBeTruthy();
    expect(formState.books.rows[0].isNewEntity).toBeTruthy();
    expect(formState.books.rows[1].isNewEntity).toBeTruthy();
    expect(formState.books.isNewEntity).toBeTruthy();

    // And when the author is not new, only it changes
    formState.id.set("1");
    expect(formState.books.rows[0].title.isNewEntity).toBeTruthy();
    expect(formState.books.rows[1].title.isNewEntity).toBeTruthy();
    expect(formState.books.rows[0].isNewEntity).toBeTruthy();
    expect(formState.books.rows[1].isNewEntity).toBeTruthy();
    expect(formState.books.isNewEntity).toBeFalsy();

    // And when the 1st book is not new, only it changes
    formState.books.rows[0].id.set("2");
    expect(formState.books.rows[0].title.isNewEntity).toBeFalsy();
    expect(formState.books.rows[1].title.isNewEntity).toBeTruthy();
    expect(formState.books.rows[0].isNewEntity).toBeFalsy();
    expect(formState.books.rows[1].isNewEntity).toBeTruthy();
    expect(formState.books.isNewEntity).toBeFalsy();
  });
});

class ObservableObject {
  firstName: string = "first";
  lastName: string = "last";

  constructor() {
    makeAutoObservable(this);
  }

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

function createAuthorInputState(input: AuthorInput, onBlur?: () => void) {
  return createObjectState<AuthorInput>(authorWithBooksConfig, input, { onBlur });
}

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

const authorWithAddressAndBooksConfig: ObjectConfig<AuthorInput> = {
  id: { type: "value" },
  firstName: { type: "value" },
  lastName: { type: "value" },
  address: {
    type: "object",
    config: {
      id: { type: "value" },
      street: { type: "value", rules: [required] },
      city: { type: "value" },
    },
  },
  books: {
    type: "list",
    config: {
      id: { type: "value" },
      title: { type: "value", rules: [required] },
      classification: { type: "value" },
    },
  },
};

function createAuthorWithAddressInputState(input: AuthorInput) {
  return createObjectState<AuthorInput>(authorWithAddressConfig, input);
}
