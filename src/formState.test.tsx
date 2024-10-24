import { autorun, isObservable, makeAutoObservable, observable, reaction } from "mobx";
import { ObjectConfig } from "src/config";
import { f } from "src/configBuilders";
import { Fragment, ObjectState, createObjectState, fragment } from "src/fields/objectField";
import { FieldState } from "src/fields/valueField";
import { AuthorAddress, AuthorInput, BookInput, Color, DateOnly, dd100, dd200, jan1, jan2 } from "src/formStateDomain";
import { required } from "src/rules";

describe("formState", () => {
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

  it("trims whitespace within the required rule", () => {
    const a: ObjectState<BookInput> = createObjectState<BookInput>(
      { title: { type: "value", rules: [required] } },
      { title: "initial valid title" },
    );
    let numErrors = 0;
    autorun(() => {
      numErrors = a.title.errors.length;
    });
    expect(a.valid).toBeTruthy();
    expect(numErrors).toEqual(0);
    // When a value contains only whitespace
    a.title.value = "  ";
    expect(a.title.valid).toBeFalsy();
    expect(numErrors).toEqual(1);
    expect(a.title.errors).toEqual(["Required"]);
    expect(a.errors).toEqual(["title: Required"]);
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

  it("can adapt values", () => {
    // Given an author where `delete` is normally a boolean
    const a = createObjectState<BookInput>(
      {
        delete: { type: "value" },
      },
      { delete: true },
    );
    const boolField = a.delete;
    // But we adapt it to a string
    const stringField = a.delete.adapt({
      toValue: (b) => String(b),
      fromValue: (s) => Boolean(s),
    });
    // Then we can read it as a string
    expect(stringField.value).toEqual("true");
    // And we can set it as a string
    stringField.value = "";
    expect(boolField.value).toBe(false);
    // And the originalValue is maintained
    expect(boolField.originalValue).toBe(true);
    expect(stringField.originalValue).toBe("true");
    // As well as the dirty.
    expect(boolField.dirty).toBe(true);
    expect(stringField.dirty).toBe(true);
    // And reverting works
    stringField.revertChanges();
    expect(boolField.dirty).toBe(false);
    expect(stringField.dirty).toBe(false);
    expect(boolField.value).toBe(true);
    expect(stringField.value).toBe("true");
  });

  it("maintains object identity", () => {
    const a1: AuthorInput = { firstName: "a1" };
    const state = createAuthorInputState(a1);
    state.firstName.set("a2");
    expect(state.value === a1).toEqual(true);
    expect(state.originalValue !== a1).toEqual(true);
    expect(a1.firstName).toEqual("a2");
  });

  it("maintains object identity of lists", () => {
    const b1: BookInput = { title: "t1" };
    const a1: AuthorInput = { firstName: "a1", books: [b1] };
    const state = createAuthorInputState(a1);
    const b2 = { title: "t2" };
    state.books.add(b2);
    expect(state.value.books === a1.books).toEqual(true);
    expect(state.books.value.length).toEqual(2);
    expect(a1.books?.length).toEqual(2);
    expect(state.books.rows[0].value === b1).toEqual(true);
    expect(state.books.rows[1].value === b2).toEqual(true);
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
    expect(state.books.rows[0].value === b2).toEqual(true);
    expect(state.books.rows[1].value === b1).toEqual(true);
    expect(ticks).toEqual(2);

    const b3 = { title: "t3" };
    state.books.add(b3, 1);
    expect(state.books.rows[0].value === b2).toEqual(true);
    expect(state.books.rows[1].value === b3).toEqual(true);
    expect(state.books.rows[2].value === b1).toEqual(true);
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

  it("list originalValue can observe changes", () => {
    const b1: BookInput = { title: "t1" };
    const a1: AuthorInput = { firstName: "a1", books: [b1] };
    const state = createAuthorInputState(a1);
    let books: any;
    let ticks = 0;
    autorun(() => {
      books = state.books.originalValue;
      ticks++;
    });
    state.books.add({ title: "t2" }, 0);
    expect(ticks).toEqual(1);
    state.commitChanges();
    expect(ticks).toEqual(2);
  });

  it("state originalValue can observe changes", () => {
    const a1: AuthorInput = { firstName: "a1", books: [] };
    const state = createAuthorInputState(a1);
    let ticks = 0;
    autorun(() => {
      noop(state.originalValue);
      ticks++;
    });
    state.books.add({ title: "t2" }, 0);
    expect(ticks).toEqual(1);
    state.commitChanges();
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
    // Then it has the ids and the new values
    expect(state.value).toMatchObject({
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

  it("passes sanitized values to validation rules", () => {
    // Given a field with a validation rule
    const rule = jest.fn().mockReturnValue("Required");
    const a = createObjectState<AuthorInput>({ firstName: { type: "value", rules: [rule] } }, {});
    expect(rule).toHaveBeenCalledTimes(0);
    // When the field is set to empty string
    a.firstName.value = "";
    expect(a.firstName.errors).toEqual(["Required"]);
    expect(rule).toHaveBeenCalledTimes(1);
    // Then the validation rule was passed undefined
    expect(rule).toHaveBeenCalledWith({
      value: undefined,
      originalValue: undefined,
      key: "firstName",
      object: expect.anything(),
    });
  });

  it("passes trimmed values to validation rules on maybeAutoSave", () => {
    // Given we have a required rule
    const rule = jest.fn().mockReturnValue("Required");
    const a = createObjectState<AuthorInput>({ firstName: { type: "value", rules: [rule] } }, {});
    expect(rule).toHaveBeenCalledTimes(0);

    // When the user initially sets an empty string value
    a.firstName.focus();
    a.firstName.value = "   ";
    expect(a.firstName.errors).toEqual(["Required"]);

    // Then initially the rule is called with the empty string
    expect(rule).toHaveBeenCalledTimes(1);
    expect(rule).toHaveBeenCalledWith({
      value: "   ",
      originalValue: undefined,
      key: "firstName",
      object: expect.anything(),
    });

    // But then when the field maybeAutoSaves (i.e. via blur)
    a.firstName.maybeAutoSave();
    expect(a.firstName.errors).toEqual(["Required"]);
    // Then the rule is called with the undefined
    expect(rule).toHaveBeenCalledTimes(2);
    expect(rule).toHaveBeenCalledWith({
      value: undefined,
      originalValue: undefined,
      key: "firstName",
      object: expect.anything(),
    });
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

  it("handles list fields with duplicate ids", () => {
    // Given an author that incorrectly has duplicate books
    const a1 = createAuthorInputState({
      books: [
        { id: "b:1", title: "b1" },
        { id: "b:1", title: "b2" },
      ],
    });
    // Then it didn't blow up
    expect(a1.books.dirty).toBeFalsy();
    // And the 1st book won
    expect(a1.books.rows[0].title.value).toBe("b1");
    expect(a1.books.rows[1].title.value).toBe("b1");
  });

  it("calls maybeAutoSave when adding or removing to a list", () => {
    const maybeAutoSave = jest.fn();
    const a1 = createAuthorInputState({ books: [] }, maybeAutoSave);
    expect(a1.books.dirty).toBeFalsy();
    a1.books.add({ title: "t2" });
    expect(a1.books.dirty).toBeTruthy();
    a1.books.remove(0);
    expect(a1.dirty).toBeFalsy();
    expect(maybeAutoSave).toBeCalledTimes(2);
  });

  it("calls maybeAutoSave when programmatically setting a value", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, maybeAutoSave);
    // When we programmatically set a field that isn't focused
    a1.firstName.value = "first";
    // Then we call maybeAutoSave
    expect(maybeAutoSave).toBeCalledTimes(1);
    // And when we set a nested value
    a1.books.rows[0].title.value = "title";
    // Then we called maybeAutoSave again
    expect(maybeAutoSave).toBeCalledTimes(2);
  });

  it("can skip maybeAutoSave when programmatically setting a value", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, maybeAutoSave);
    // When we programmatically set a field that isn't focused
    a1.set({ firstName: "first" }, { autoSave: false });
    // Then we don't call maybeAutoSave
    expect(maybeAutoSave).toBeCalledTimes(0);
  });

  it("defers calling maybeAutoSave when setting a focused value", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, maybeAutoSave);
    // And the field is focused
    a1.firstName.focus();
    // When we we set the field
    a1.firstName.value = "first";
    // Then we don't call maybeAutoSave
    expect(maybeAutoSave).toBeCalledTimes(0);
  });

  it("skips maybeAutoSave when refreshing", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, maybeAutoSave);
    // When we programmatically set a field that isn't focused
    (a1 as any).set({ firstName: "first" }, { refreshing: true });
    // Then we don't call maybeAutoSave
    expect(maybeAutoSave).toBeCalledTimes(0);
  });

  it("skips maybeAutoSave when resetting", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ books: [{}] }, maybeAutoSave);
    // And we called maybeAutoSave once
    a1.set({ firstName: "first" });
    expect(maybeAutoSave).toBeCalledTimes(1);
    // When we reset
    a1.revertChanges();
    // We don't call blur again
    expect(maybeAutoSave).toBeCalledTimes(1);
  });

  it("skips maybeAutoSave when not dirty", () => {
    const maybeAutoSave = jest.fn();
    // Given an author listening for blur
    const a1 = createAuthorInputState({ firstName: "first", books: [{}] }, maybeAutoSave);
    // When we programmatically set a field to it's existing valued
    a1.firstName.value = "first";
    // Then we don't call maybeAutoSave
    expect(maybeAutoSave).toBeCalledTimes(0);
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

  it("can evaluate arrays to be equal even if order of options are different from original when strictOrder = false", () => {
    // Given an array field value where we define `strictOrder` as false
    const a1 = createObjectState<AuthorInput>(
      { favoriteColors: { type: "value", strictOrder: false } },
      { favoriteColors: [Color.Red, Color.Blue] },
    );
    expect(a1.favoriteColors.dirty).toBeFalsy();
    // When changing the order of the values
    a1.favoriteColors.set([Color.Blue, Color.Red]);
    // Then expect the field to not be dirty
    expect(a1.dirty).toBeFalsy();
  });

  it("evaluates arrays to be equal based on order by default", () => {
    // Given an array field value
    const a1 = createObjectState<AuthorInput>(
      { favoriteColors: { type: "value" } },
      { favoriteColors: [Color.Red, Color.Blue] },
    );
    expect(a1.favoriteColors.dirty).toBeFalsy();
    // When we change the order of the values
    a1.favoriteColors.set([Color.Blue, Color.Red]);
    // Then the field should be dirty
    expect(a1.dirty).toBeTruthy();
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
    a1.revertChanges();
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
        { id: "b:1", title: "b1", classification: dd100 },
        { id: "b:2", title: "b2", classification: dd100 },
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
    a1.revertChanges();
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
    a1.firstName.commitChanges();
    expect(a1.firstName.dirty).toBeFalsy();

    // verify ListFieldState is dirty, then save, then no longer dirty.
    expect(a1.books.dirty).toBeTruthy();
    a1.books.commitChanges();
    expect(a1.books.dirty).toBeFalsy();

    // Verify the remaining form is still dirty
    expect(a1.dirty).toBeTruthy();
    a1.commitChanges();
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
    expect(a1.originalValue.firstName).toBe("asdf");
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

  it("has an object-level readOnly=true override field-level readOnly=false", () => {
    // Given a top-level object
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });
    // And it is read-only
    a1.readOnly = true;
    // Then its fields are read-only
    const fields = [a1, a1.firstName, a1.books, a1.books.rows[0].title, a1.books.rows[0].classification];
    fields.forEach((f) => expect(f.readOnly).toBeTruthy());
    // And even if a specific field tries to _not_ be read-only,
    // i.e. due to a more granular business rule that happens to
    // be allowed right now
    a1.firstName.readOnly = false;
    // Then the field-level rule is ignored, and it's still treated as read-only
    expect(a1.firstName.readOnly).toBeTruthy();
  });

  it("has an field-level readOnly=true override object-level readOnly=false", () => {
    // Given a top-level object
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });
    // And the top-level form is explicitly set to read-only=false
    a1.readOnly = false;
    // Then its fields are not read-only
    const fields = [a1, a1.firstName, a1.books, a1.books.rows[0].title, a1.books.rows[0].classification];
    fields.forEach((f) => expect(f.readOnly).toBeFalsy());
    // But when one of the fields opts in to readOnly
    a1.firstName.readOnly = true;
    // Then the field-level rule is respected
    expect(a1.firstName.readOnly).toBeTruthy();
  });

  it("has an object-level loading=true override field-level loading=false", () => {
    // Given a top-level object
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });
    // And it is loading
    a1.loading = true;
    // Then its fields are read-only
    const fields = [a1, a1.firstName, a1.books, a1.books.rows[0].title, a1.books.rows[0].classification];
    fields.forEach((f) => expect(f.loading).toBeTruthy());
    // And even if a specific field tries to _not_ be loading
    a1.firstName.loading = false;
    // Then the field-level value is ignored, and it's still treated as loading
    expect(a1.firstName.loading).toBeTruthy();
  });

  it("has an field-level loading=true override object-level loading=false", () => {
    // Given a top-level object
    const a1 = createAuthorInputState({
      firstName: "a1",
      lastName: "aL1",
      books: [{ title: "b1", classification: dd100 }],
    });
    // And the top-level form is explicitly set to loading=false
    a1.loading = false;
    // Then its fields are not loading
    const fields = [a1, a1.firstName, a1.books, a1.books.rows[0].title, a1.books.rows[0].classification];
    fields.forEach((f) => expect(f.loading).toBeFalsy());
    // But when one of the fields opts in to loading
    a1.firstName.loading = true;
    // Then the field-level loading is respected
    expect(a1.firstName.loading).toBeTruthy();
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
    a.revertChanges();
  });

  it("can set nested values when original null", () => {
    const a = createAuthorWithAddressInputState({ address: null });
    a.address.city.value = "b1";
    expect(a.address.city.value).toEqual("b1");
    expect(a.address.value).toMatchInlineSnapshot(`
      {
        "city": "b1",
      }
    `);
    expect(a.value).toMatchInlineSnapshot(`
      {
        "address": {
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

  it("can reset observable objects with computeds", () => {
    const formState = createObjectState(
      {
        firstName: { type: "value" },
        lastName: { type: "value" },
        fullName: { type: "value" },
      },
      new ObservableObject(),
    );

    expect(formState.firstName.value).toEqual("first");
    expect(formState.fullName.value).toEqual("first last");
    expect(formState.fullName.dirty).toEqual(false);

    formState.firstName.value = "change";
    expect(formState.fullName.value).toEqual("change last");
    expect(formState.fullName.dirty).toEqual(true);

    formState.revertChanges();
    expect(formState.firstName.value).toEqual("first");
  });

  it("can observe observable objects being mutated directly", () => {
    // Given a mobx class with a computed
    const instance = new ObservableObject();
    const formState = createObjectState(authorWithFullName, instance);
    expect(formState.firstName.value).toEqual("first");
    expect(formState.fullName.value).toEqual("first last");

    // And we hook up reactivity to the computed
    let numCalcs = 0;
    autorun(() => {
      numCalcs++;
      noop(formState.fullName.value);
    });

    // When the underlying mobx class is directly changed
    instance.firstName = "change";
    // Then our form-state computed re-run
    expect(numCalcs).toBe(2);
    expect(formState.fullName.value).toEqual("change last");

    // And when the underlying mobx class has a field unset
    instance.firstName = undefined;
    // Then our form-state computed re-runs again
    expect(numCalcs).toBe(3);
    expect(formState.fullName.value).toEqual("undefined last");
    // And knows the field should be sent as null
    expect(formState.changedValue).toEqual({ firstName: null });
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
    formState.revertChanges();
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

    formState.revertChanges();
    expect(formState.firstName.value).toEqual("first");
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

  it("changedValue includes initialized-and-unchanged list fields", () => {
    // Given a new author that is initialized with a new book
    const formState = createObjectState(authorWithBooksConfig, {
      books: [{ title: "t1" }],
    });
    // Then changedValue realizes that even though `books` is not changed, it should be included
    expect(formState.books.dirty).toBe(false);
    expect(formState.changedValue).toEqual({ books: [{ title: "t1" }] });
  });

  it("changedValue skips initialized-and-unchanged list fields that are empty", () => {
    // Given a new author that is initialized with no books
    const formState = createObjectState(authorWithBooksConfig, {
      books: [],
    });
    // Then changedValue doesn't include the books
    expect(formState.changedValue).toEqual({});
  });

  it("changedValue includes new entity nested fields", () => {
    // Given a new author with an address FK
    const formState = createObjectState(authorWithAddressFkConfig, {
      firstName: "f",
      address: { id: "add:1" },
    });
    // Then changedValue includes the reference to the FK
    expect(formState.changedValue).toEqual({
      firstName: "f",
      address: { id: "add:1" },
    });
  });

  it("changedValue includes new entity nested fields with multiple keys", () => {
    // Given a new author with an address FK
    const formState = createObjectState(authorWithAddressFkConfig, { firstName: "f" });
    formState.address.set({ id: "add:1", street: "Main St" });
    // Then changedValue includes the reference to the FK
    expect(formState.changedValue).toEqual({
      firstName: "f",
      address: { id: "add:1", street: "Main St" },
    });
  });

  it("changedValue includes deleted nested fields", () => {
    // Given a new author with an address FK
    const formState = createObjectState(
      f.config<AuthorInput>({
        id: f.value(),
        firstName: f.value(),
        // And address is a reference
        address: f.reference(),
      }),
      { id: "a:1", firstName: "f", address: { id: "add:1" } },
    );
    // When the address is unset
    formState.address.set(undefined);
    // Then the field is dirty and will be removed in changedValue
    expect(formState.address.dirty).toBe(true);
    expect(formState.dirty).toBe(true);
    expect(formState.changedValue).toEqual({
      id: "a:1",
      address: { id: null },
    });
    // So that we can do a binding like
    const addressId = formState.changedValue.address?.id;
    expect(addressId).toBeNull();
    // And when we're restored to the same value
    formState.address.set({ id: "add:1" });
    // Then it's back to not being dirty
    expect(formState.address.dirty).toBe(false);
    expect(formState.dirty).toBe(false);
    // And when we're changed to a different address
    formState.address.set({ id: "add:2" });
    // Then we're dirty again
    expect(formState.changedValue).toEqual({
      id: "a:1",
      address: { id: "add:2" },
    });
  });

  it("changedValue includes deleted nested fields with a name", () => {
    // Given a new author with an address FK
    const formState = createObjectState(
      f.config<AuthorInput>({
        id: f.value(),
        firstName: f.value(),
        address: f.reference<AuthorAddress>({ street: f.value() }),
      }),
      { id: "a:1", firstName: "f", address: { id: "add:1", street: "Main St" } },
    );
    // Initially both id and street can be bound to the UI
    expect(formState.address.id.value).toBe("add:1");
    expect(formState.address.street.value).toBe("Main St");
    // When the address is unset
    formState.address.set(undefined);
    // Then the field is dirty and will be removed in changedValue
    expect(formState.address.dirty).toBe(true);
    // And our changedValue only includes the id
    expect(formState.changedValue).toEqual({
      id: "a:1",
      address: { id: null },
    });
    // And when we're changed to a new address
    formState.address.set({ id: "add:2", street: "Side St" });
    // Then we see oly the id come back in changedValue
    expect(formState.changedValue).toEqual({
      id: "a:1",
      address: { id: "add:2" },
    });
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

  it("changedValue skips computeds", () => {
    // Given a new author that calls full name
    const formState = createObjectState(authorWithFullName, new ObservableObject());
    expect(formState.fullName.value).toEqual("first last");
    // When the firstName changes
    formState.firstName.value = "First";
    // Then the fullName changes
    expect(formState.fullName.value).toBe("First last");
    expect(formState.fullName.dirty).toBe(true);
    // And we don't include it in the changedValue
    expect(formState.changedValue).toEqual({ firstName: "First" });
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
    // And add a 3rd new book
    formState.books.add({ title: "t3" });
    // Then we get the author id (for updates) and all 3 books
    expect(formState.changedValue).toEqual({
      id: "a:1",
      books: [{ id: "b:1", title: "t1b" }, { id: "b:2" }, { title: "t3" }],
    });
    // And we can still get the original value
    expect(formState.originalValue).toEqual({
      id: "a:1",
      firstName: "f",
      books: [
        { id: "b:1", title: "t1" },
        { id: "b:2", title: "t2" },
      ],
    });
    // And the books.originalValue as well
    expect(formState.books.originalValue).toEqual([
      { id: "b:1", title: "t1" },
      { id: "b:2", title: "t2" },
    ]);
    // And when we commit changes
    formState.commitChanges();
    // Then our originalValue reflects the commit
    expect(formState.originalValue).toEqual({
      id: "a:1",
      firstName: "f",
      books: [
        { id: "b:1", title: "t1b" },
        { id: "b:2", title: "t2" },
        { id: undefined, title: "t3" },
      ],
    });
    // And the books.originalValue as well
    expect(formState.books.originalValue).toEqual([
      { id: "b:1", title: "t1b" },
      { id: "b:2", title: "t2" },
      { title: "t3" },
    ]);
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

  it("uses the op key as a hint to use incremental list behavior", () => {
    // Given an author
    const formState = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        // And the books collection is not explicitly marked as incremental
        books: {
          type: "list",
          config: {
            id: { type: "value" },
            title: { type: "value", rules: [required] },
            // But it does have an op key
            op: { type: "value" },
          },
        },
      },
      {
        id: "a:1",
        firstName: "f",
        books: [
          // And the books start out as included
          { id: "b:1", title: "t1", op: "include" },
          { id: "b:2", title: "t2", op: "include" },
        ],
      },
    );
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we delete the 1st book
    formState.books.rows[0].op.value = "delete";
    // Then only the 1st book is included
    expect(formState.changedValue).toEqual({
      id: "a:1",
      books: [{ id: "b:1", op: "delete" }],
    });
  });

  it("defaults the incremental op key to included when not set", () => {
    // Given an author
    const formState = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        // And the books collection is not explicitly marked as incremental
        books: {
          type: "list",
          config: {
            id: { type: "value" },
            title: { type: "value", rules: [required] },
            // But it does have an op key
            op: { type: "value" },
          },
        },
      },
      {
        id: "a:1",
        firstName: "f",
        books: [
          // And no op keys are initially set
          { id: "b:1", title: "t1" },
          { id: "b:2", title: "t2" },
        ],
      },
    );
    // And initially nothing is changed
    expect(formState.changedValue).toEqual({ id: "a:1" });
    // When we delete the 1st book
    formState.books.rows[0].op.value = "delete";
    // And add a 3rd book
    formState.books.add({ title: "t3" });
    // Then the 3rd book doesn't have an explicit op yet
    expect(formState.books.rows[2].op.value).toBeUndefined();
    // But when we create changedValue
    expect(formState.changedValue).toEqual({
      id: "a:1",
      books: [
        // Then the deleted book is included
        { id: "b:1", op: "delete" },
        // And the 3rd book is included w/the `op: include` flag added
        { title: "t3", op: "include" },
      ],
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

  it("can observe value changes on lists", () => {
    const formState = createObjectState(authorWithBooksConfig, { books: [{ title: "b1" }] });
    let ticks = 0;
    reaction(
      () => formState.books.value,
      () => ticks++,
      { equals: () => false },
    );
    expect(ticks).toEqual(0);
    formState.books.rows[0].title.value = "b1";
    expect(ticks).toEqual(0);
    formState.books.rows[0].title.value = "b1...";
    expect(ticks).toEqual(1);
    formState.books.add({ title: "b2" });
    expect(ticks).toEqual(2);
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

  it("trims string values on maybeAutoSave", () => {
    const formState = createObjectState(authorWithBooksConfig, { firstName: "f", lastName: "l" });
    // Given the user is typing with spaces
    formState.firstName.focus();
    formState.firstName.set("f ");
    // And we initially keep the space
    expect(formState.firstName.value).toEqual("f ");
    // When the user hits Enter (which will call maybeAutoSave)
    formState.firstName.maybeAutoSave();
    // Then we trim it
    expect(formState.firstName.value).toEqual("f");
    // And the field is considered touched
    expect(formState.firstName.touched).toEqual(true);
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
    let field1: FieldState<string | undefined | null>;
    field1 = form.firstName;
    // But not on id
    // @ts-expect-error
    field1 = form.id;
    // And same thing with any as the object type
    let field2: FieldState<string | undefined | null>;
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
    let field: FieldState<AuthorAddress | null | undefined>;
    // Then we can assign the value
    field = a.address;
    // And treat it as a value object
    a.address.set({ street: "123", city: "nyc" });
    expect(a.value).toEqual({ address: { street: "123", city: "nyc" } });
  });

  it("can have child object states with cycles", () => {
    // Given an author with an address child
    // And two addresses that are basically identical and both have cycles
    const address1: AuthorAddress = { city: "city2" };
    (address1 as any).someCycle = address1;
    const address2: AuthorAddress = { city: "city2" };
    (address2 as any).someCycle = address2;
    const a = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        address: { type: "value" },
      },
      { address: address1 },
    );
    // When we change the address
    a.address.set(address2);
    // Then it doesn't error on dirty checks
    expect(a.address.dirty).toBe(false);
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

  it("can properly evaluate dirty lists after calling 'save'", () => {
    // Given an empty list state
    const a1 = createAuthorInputState({ books: [] });
    expect(a1.books.dirty).toBeFalsy();
    // When adding a book
    a1.books.add({ title: "t2" });
    // Then the list state is dirty
    expect(a1.books.dirty).toBeTruthy();
    // When saving the form state
    a1.commitChanges();
    // Then the list is no longer dirty
    expect(a1.books.dirty).toBeFalsy();
    // When adding a new book
    a1.books.add({ title: "t3" });
    // The list is again dirty
    expect(a1.books.dirty).toBeTruthy();
  });

  it("can properly evaluate dirty lists when order changes", () => {
    // Given a list state in a specific order
    const a = createAuthorInputState({ books: [{ title: "t1" }, { title: "t2" }] });
    expect(a.books.dirty).toBeFalsy();
    // When changing that order
    const book1 = a.books.rows[0].value;
    a.books.remove(book1);
    a.books.add(book1);
    // Then the list state is considered dirty.
    expect(a.books.dirty).toBeTruthy();
    // When putting the books back in the original order
    a.books.remove(book1);
    a.books.add(book1, 0);
    // Then the list state is no longer dirty
    expect(a.books.dirty).toBeFalsy();
  });

  it("can optionally ignore the order of list state rows when determining dirty state", () => {
    // Given a list state in a specific order, and the `strictOrder` option set to `false`
    const a = createObjectState<AuthorInput>(
      {
        books: {
          type: "list",
          strictOrder: false,
          config: {
            title: { type: "value", rules: [required] },
          },
        },
      },
      { books: [{ title: "t1" }, { title: "t2" }] },
    );

    expect(a.books.dirty).toBeFalsy();
    // When changing that order
    const book1 = a.books.rows[0].value;
    a.books.remove(book1);
    a.books.add(book1);
    // Then the list state is still not considered dirty.
    expect(a.books.dirty).toBeFalsy();
  });

  describe("fragments", () => {
    type BookWithFragment = BookInput & { data: Fragment<{ foo: string }> };

    it("ignores changes within fragments", () => {
      const a: ObjectState<BookWithFragment> = createObjectState<BookWithFragment>(
        { title: { type: "value" }, data: { type: "fragment" } },
        { title: "b1", data: fragment({ foo: "1" }) },
      );
      let numCalcs = 0;
      autorun(() => {
        numCalcs++;
        noop(a.value);
      });
      expect(a.data.value).toEqual({ foo: "1" });
      expect(isObservable(a.data.value)).toBe(false);
      expect(numCalcs).toEqual(1);
      a.data.value = { foo: "2" };
      expect(numCalcs).toEqual(2);
      a.data.value.foo = "3";
      expect(numCalcs).toEqual(2);
    });

    it("ignores fragments in changedValue", () => {
      const a: ObjectState<BookWithFragment> = createObjectState<BookWithFragment>(
        { title: { type: "value" }, data: { type: "fragment" } },
        { title: "b1", data: fragment({ foo: "1" }) },
      );
      a.title.value = "b2";
      a.data.value = fragment({ foo: "2" });
      expect(a.changedValue).toMatchInlineSnapshot(`
        {
          "title": "b2",
        }
      `);
    });

    it("ignores fragments in value", () => {
      const a: ObjectState<BookWithFragment> = createObjectState<BookWithFragment>(
        { title: { type: "value" }, data: { type: "fragment" } },
        { title: "b1", data: fragment({ foo: "1" }) },
      );
      expect(a.value).toMatchInlineSnapshot(`
        {
          "title": "b1",
        }
      `);
    });
  });

  it("sets id key correctly", () => {
    // Given an author
    const a = createObjectState<AuthorInput>(
      {
        id: { type: "value" },
        otherId: { type: "value", isIdKey: true },
      },
      {},
    );
    expect((a.id as any)._isIdKey).toBe(false);
    expect((a.otherId as any)._isIdKey).toBe(true);
  });

  it("uses id key to recognize same entities", () => {
    // With b1 having an id
    const b1 = createObjectState<BookInput>({ id: { type: "value" } }, { id: "b:1" });
    expect((b1 as any).isSameEntity({ id: "b:1" })).toBe(true);
    expect((b1 as any).isSameEntity({ id: "b:2" })).toBe(false);
    expect((b1 as any).isSameEntity({ id: undefined })).toBe(false);
    expect((b1 as any).isSameEntity({})).toBe(false);

    // With b2 having no id
    const b2 = createObjectState<BookInput>({ id: { type: "value" } }, {});
    expect((b2 as any).isSameEntity({ id: "b:1" })).toBe(false);
    expect((b2 as any).isSameEntity({ id: undefined })).toBe(false);
    expect((b2 as any).isSameEntity({})).toBe(false);

    // With b3 having no id key
    const b3 = createObjectState<BookInput>({ title: { type: "value" } }, { title: "b3" });
    expect((b3 as any).isSameEntity({ title: "b3" })).toBe(false);

    // With b4 having a different id key
    const b4 = createObjectState<BookInput>({ title: { type: "value", isIdKey: true } }, { title: "b4" });
    expect((b4 as any).isSameEntity({ title: "b4" })).toBe(true);
  });
});

export class ObservableObject {
  firstName: string | undefined = "first";
  lastName: string | undefined = "last";
  age?: number | undefined = undefined;

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

  toInput(): { firstName: string | undefined } {
    return { firstName: this.firstName };
  }
}

const authorWithBooksConfig = f.config<AuthorInput>({
  id: f.value(),
  firstName: f.value(),
  lastName: f.value(),
  books: f.list({
    id: f.value(),
    title: f.value().req(),
    classification: f.value(),
  }),
});

function createAuthorInputState(input: AuthorInput, maybeAutoSave?: () => void) {
  return createObjectState<AuthorInput>(authorWithBooksConfig, input, { maybeAutoSave });
}

const authorWithFullName: ObjectConfig<ObservableObject> = {
  firstName: { type: "value" },
  lastName: { type: "value" },
  fullName: { type: "value", computed: true },
};

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

const authorWithAddressFkConfig: ObjectConfig<AuthorInput> = {
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
};

const authorWithAddressAndBooksConfig = f.config<AuthorInput>({
  id: f.value(),
  firstName: f.value(),
  lastName: f.value(),
  address: f.object({
    id: f.value(),
    street: f.value().rules([required]),
    city: f.value(),
  }),
  books: f.list({
    id: f.value(),
    title: f.value(),
    classification: f.value(),
  }),
});

// const authorWithAddressAndBooksConfig: ObjectConfig<AuthorInput> = {
//   id: { type: "value" },
//   firstName: { type: "value" },
//   lastName: { type: "value" },
//   address: {
//     type: "object",
//     config: {
//       id: { type: "value" },
//       street: { type: "value", rules: [required] },
//       city: { type: "value" },
//     },
//   },
//   books: {
//     type: "list",
//     config: {
//       id: { type: "value" },
//       title: { type: "value", rules: [required] },
//       classification: { type: "value" },
//     },
//   },
// };

function createAuthorWithAddressInputState(input: AuthorInput) {
  return createObjectState<AuthorInput>(authorWithAddressConfig, input);
}

function noop(t: unknown): void {}
