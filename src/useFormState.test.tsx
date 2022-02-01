import { click, clickAndWait, render, wait } from "@homebound/rtl-utils";
import { Observer } from "mobx-react";
import { useMemo, useState } from "react";
import { AuthorInput } from "src/formStateDomain";
import { FieldState, ObjectConfig, ObjectState, required } from "./formState";
import { useFormState } from "./useFormState";

describe("useFormState", () => {
  it("calls init.map if init.input is defined", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = Pick<AuthorInput, "firstName">;
      const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
      // And we have query data that may or may not be defined
      const data: { firstName: string } | undefined = Math.random() >= 0 ? { firstName: "bob" } : undefined;
      // Then the lambda is passed the "de-undefined" data
      const form = useFormState({
        config,
        init: { input: data, map: (d) => ({ firstName: d.firstName }) },
      });
      return <div>{form.firstName.value}</div>;
    }
    const r = await render(<TestComponent />);
    expect(r.baseElement).toHaveTextContent("bob");
  });

  it("memoizes on init.input being an array", async () => {
    // Given a component
    type FormValue = Pick<AuthorInput, "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent() {
      const [, setTick] = useState(0);
      const form = useFormState({
        config,
        init: { input: ["a", "b"], map: ([a, b]) => ({ firstName: a + b }) },
      });
      const onClick = () => [form.firstName.set("fred"), setTick(1)];
      return (
        <div>
          <button data-testid="change" onClick={onClick} />
          <div data-testid="firstName">{form.firstName.value}</div>
        </div>
      );
    }
    const r = await render(<TestComponent />);
    expect(r.firstName()).toHaveTextContent("ab");
    click(r.change);
    expect(r.firstName()).toHaveTextContent("fred");
  });

  it("uses default if init.input is undefined", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = Pick<AuthorInput, "firstName">;
      const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
      // And we have query data that may or may not be defined (but is actually undefined)
      const data: { firstName: string | undefined | null } | undefined =
        Math.random() >= 0 ? undefined : { firstName: "bob" };
      const form = useFormState({
        config,
        init: { input: data, map: (d) => ({ firstName: d.firstName }) },
      });
      return <div>{form.firstName.value}</div>;
    }
    const r = await render(<TestComponent />);
    // Then we init.map wasn't called, and we used {} instead
    expect(r.baseElement.textContent).toEqual("");
  });

  it("uses custom init.ifUndefined if init.input is undefined", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = Pick<AuthorInput, "id" | "firstName">;
      const config: ObjectConfig<FormValue> = {
        id: { type: "value" },
        firstName: { type: "value" },
      };
      // And we have query data that may or may not be defined (but is actually undefined)
      const data: { firstName: string | undefined | null } | undefined =
        Math.random() >= 0 ? undefined : { firstName: "bob" };
      const form = useFormState({
        config,
        // And we pass `ifUndefined`
        init: {
          input: data,
          map: (d) => ({ firstName: d.firstName }),
          ifUndefined: { firstName: "default" },
        },
      });
      return (
        <div>
          <div data-testid="firstName">{form.firstName.value}</div>
          <div data-testid="changedValue">{JSON.stringify(form.changedValue)}</div>
        </div>
      );
    }
    const r = await render(<TestComponent />);
    // Then we use the ifUndefined value
    expect(r.firstName.textContent).toEqual("default");
    expect(r.changedValue.textContent).toEqual(JSON.stringify({ firstName: "default" }));
  });

  it("uses init if set as a value", async () => {
    // Given a component
    type FormValue = Pick<AuthorInput, "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent() {
      const [, setTick] = useState(0);
      const form = useFormState({
        config,
        // That's using a raw init value
        init: { firstName: "bob" },
      });
      return (
        <div>
          <button
            data-testid="change"
            onClick={() => {
              // When that value changes
              form.firstName.set("fred");
              // And also we re-render the component
              setTick(1);
            }}
          />
          <div data-testid="firstName">{form.firstName.value}</div>
        </div>
      );
    }
    const r = await render(<TestComponent />);
    expect(r.firstName()).toHaveTextContent("bob");
    click(r.change);
    // Then the change didn't get dropped due to init being unstable
    expect(r.firstName()).toHaveTextContent("fred");
  });

  it("doesn't required an init value", async () => {
    function TestComponent() {
      type FormValue = Pick<AuthorInput, "firstName">;
      const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
      const form = useFormState({ config });
      return <div>{form.firstName.value}</div>;
    }
    const r = await render(<TestComponent />);
    expect(r.baseElement.textContent).toEqual("");
  });

  it("keeps local changed values when a query refreshes", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = AuthorInput;
      const config: ObjectConfig<FormValue> = authorWithAddressAndBooksConfig;
      // And we have two sets of data
      const data1 = {
        id: "a:1",
        firstName: "f1",
        lastName: "l1",
        address: { id: "address:1", street: "s1", city: "c1" },
        books: [
          { id: "b:1", title: "a1" },
          { id: "b:2", title: "b1" },
        ],
      };
      const data2 = {
        id: "a:1",
        firstName: "f2",
        lastName: "l2",
        address: { id: "address:1", street: "s2", city: "c2" },
        books: [
          { id: "b:1", title: "a2" },
          { id: "b:2", title: "b2" },
          { id: "b:3", title: "b3" },
        ],
      };
      // Eventually our local values are saved
      const data3 = {
        id: "a:1",
        firstName: "local",
        lastName: "l2",
        address: { id: "address:1", street: "local", city: "c2" },
        books: [
          { id: "b:1", title: "local" },
          { id: "b:2", title: "b2" },
          { id: "b:3", title: "b3" },
        ],
      };
      // And we start out with data1
      const [data, setData] = useState<FormValue>(data1);
      const form = useFormState({ config, init: { input: data, map: (d) => d } });
      function makeLocalChanges() {
        form.firstName.value = "local";
        form.address.street.value = "local";
        form.books.rows[0].title.value = "local";
      }
      return (
        <Observer>
          {() => (
            <div>
              <div data-testid="firstName">{form.firstName.value}</div>
              <div data-testid="lastName">{form.lastName.value}</div>
              <div data-testid="street">{form.address.street.value}</div>
              <div data-testid="city">{form.address.city.value}</div>
              <div data-testid="title1">{form.books.rows[0].title.value}</div>
              <div data-testid="title2">{form.books.rows[1].title.value}</div>
              <div data-testid="booksLength">{form.books.rows.length}</div>
              <button data-testid="makeLocalChanges" onClick={makeLocalChanges} />
              <button data-testid="refreshData" onClick={() => setData(data2)} />
              <button data-testid="saveData" onClick={() => setData(data3)} />
              <div data-testid="changedValue">{JSON.stringify(form.changedValue)}</div>
            </div>
          )}
        </Observer>
      );
    }

    // And we start out with the initial query data
    const r = await render(<TestComponent />);
    expect(r.firstName().textContent).toEqual("f1");
    expect(r.street().textContent).toEqual("s1");
    expect(r.title1().textContent).toEqual("a1");

    // When we make some local changes
    click(r.makeLocalChanges);
    // Then we see them
    expect(r.firstName().textContent).toEqual("local");
    expect(r.street().textContent).toEqual("local");
    expect(r.title1().textContent).toEqual("local");
    expect(JSON.parse(r.changedValue().textContent)).toEqual({
      id: "a:1",
      address: { id: "address:1", street: "local" },
      books: [{ id: "b:1", title: "local" }, { id: "b:2" }],
      firstName: "local",
    });

    // And when the new query is ran i.e. due to a cache refresh
    click(r.refreshData);

    // Then we kept our local changes
    expect(r.firstName().textContent).toEqual("local");
    expect(r.street().textContent).toEqual("local");
    expect(r.title1().textContent).toEqual("local");
    // But we also see the new data for fields we have not changed
    expect(r.lastName().textContent).toEqual("l2");
    expect(r.city().textContent).toEqual("c2");
    expect(r.title2().textContent).toEqual("b2");
    expect(r.booksLength().textContent).toEqual("3");
    expect(JSON.parse(r.changedValue().textContent)).toEqual({
      id: "a:1",
      address: { id: "address:1", street: "local" },
      books: [{ id: "b:1", title: "local" }, { id: "b:2" }, { id: "b:3" }],
      firstName: "local",
    });

    // And then when our mutation results come back
    click(r.saveData);
    // Then changedValue doesn't show our local changes anymore
    expect(JSON.parse(r.changedValue().textContent)).toEqual({
      id: "a:1",
    });
  });

  it("useFormState can accept new data while read only", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = AuthorInput;
      const config: ObjectConfig<FormValue> = authorWithAddressAndBooksConfig;
      // And we have two sets of data
      const data1 = {
        firstName: "f1",
        address: { street: "s1" },
        books: [{ title: "a1" }],
      };
      const data2 = {
        firstName: "f2",
        address: { street: "s2" },
        books: [{ title: "a2" }],
      };
      // And we start out with data1
      const [data, setData] = useState<FormValue>(data1);
      const form = useFormState({
        config,
        init: { input: data, map: (d) => d },
        // And the form is read only
        readOnly: true,
      });
      return (
        <Observer>
          {() => (
            <div>
              <div data-testid="firstName">{form.firstName.value}</div>
              <div data-testid="street">{form.address.street.value}</div>
              <div data-testid="title1">{form.books.rows[0].title.value}</div>
              <button data-testid="refreshData" onClick={() => setData(data2)} />
            </div>
          )}
        </Observer>
      );
    }
    // And we start out with the initial query data
    const r = await render(<TestComponent />);
    expect(r.firstName().textContent).toEqual("f1");
    expect(r.street().textContent).toEqual("s1");
    expect(r.title1().textContent).toEqual("a1");

    // When the new query is ran i.e. due to a cache refresh
    click(r.refreshData);

    // Then we see the latest data
    expect(r.firstName().textContent).toEqual("f2");
    expect(r.street().textContent).toEqual("s2");
    expect(r.title1().textContent).toEqual("a2");
  });

  it("useFormState can accept new data with computed fields", async () => {
    // Given a component
    function TestComponent() {
      // And it's using a class/mobx proxy as the basis for the data
      class AuthorRow {
        constructor(public firstName: string, public lastName: string) {}
        get fullName() {
          return this.firstName + " " + this.lastName;
        }
      }
      // And we have two sets of data
      const data1 = { firstName: "f1", lastName: "l1" };
      const data2 = { firstName: "f2", lastName: "l2" };
      // And we start out with data1
      const [data, setData] = useState<typeof data1>(data1);
      const author = useMemo(() => new AuthorRow(data.firstName, data.lastName), [data]);
      const config: ObjectConfig<AuthorRow> = useMemo(
        () => ({
          firstName: { type: "value" },
          lastName: { type: "value" },
          fullName: { type: "value", computed: true },
        }),
        [],
      );
      const form = useFormState({ config, init: { input: author, map: (a) => a } });
      return (
        <Observer>
          {() => (
            <div>
              <div data-testid="firstName">{form.firstName.value}</div>
              <div data-testid="fullName">{form.fullName.value}</div>
              <button data-testid="refreshData" onClick={() => setData(data2)} />
            </div>
          )}
        </Observer>
      );
    }
    // And we start out with the initial query data
    const r = await render(<TestComponent />);
    expect(r.firstName().textContent).toEqual("f1");
    expect(r.fullName().textContent).toEqual("f1 l1");
    // When the new query is ran i.e. due to a cache refresh
    click(r.refreshData);
    expect(r.firstName().textContent).toEqual("f2");
    expect(r.fullName().textContent).toEqual("f2 l2");
  });

  it("can trigger auto save for fields in list that were initially undefined", async () => {
    const autoSave = jest.fn();
    // Given a component
    function TestComponent() {
      // When the data is initially undefined
      const [data, setData] = useState<AuthorInput>();
      const data2 = { books: [{ title: "Title 1" }] };
      const form = useFormState({
        config: authorWithBooksConfig,
        init: { input: data, map: (d) => d, ifUndefined: { books: [] } },
        autoSave,
      });
      return (
        <Observer>
          {() => (
            <div>
              <button data-testid="refreshData" onClick={() => setData(data2)} />
              <button data-testid="add" onClick={() => form.books.add({ title: "New Book" })} />
              <button data-testid="blurBookOne" onClick={() => focusAndBlur(form.books.rows[0].title)} />
              <button data-testid="blurBookTwo" onClick={() => focusAndBlur(form.books.rows[1].title)} />
            </div>
          )}
        </Observer>
      );
    }

    // Given a formState with `onBlur` set
    const r = await render(<TestComponent />);
    // When the data/child is now available
    click(r.refreshData);
    // And the field is blurred
    await clickAndWait(r.blurBookOne);
    // Then we don't auto-save because nothing has changed
    expect(autoSave).toBeCalledTimes(0);

    // And when adding a new book
    click(r.add);
    // We autoSave the new row right away (because we don't have any validation rules
    // that say the new row can't be empty)
    expect(autoSave).toBeCalledTimes(1);
    // And the new book is blurred
    await clickAndWait(r.blurBookTwo);
    // Then we auto save again
    expect(autoSave).toBeCalledTimes(2);
  });

  it("does not infinite loop when calling set inside of auto-save", async () => {
    // Given a component
    let autoSaves = 0;
    function TestComponent() {
      type FormValue = AuthorInput;
      const config: ObjectConfig<FormValue> = authorConfig;
      const data = { firstName: "f1", lastName: "f1" };
      const form = useFormState({
        config,
        init: data,
        // And there is reactive business logic in the `autoSave` method
        async autoSave(state) {
          state.lastName.set("l2");
          autoSaves++;
        },
      });
      return (
        <div>
          <button data-testid="setFirst" onClick={() => form.firstName.set("f2")} />
        </div>
      );
    }
    const r = await render(<TestComponent />);
    // When we change firstName
    click(r.setFirst);
    // When autoSave didn't infinite loop
    expect(autoSaves).toEqual(1);
  });

  it("can queue up changes for auto save if a save is already in progress", async () => {
    const autoSaveStub = jest.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName" | "lastName">;
    const config: ObjectConfig<FormValue> = {
      id: { type: "value" },
      firstName: { type: "value" },
      lastName: { type: "value" },
    };

    // Given a component using `getObjectState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Brandon", lastName: "Dow" });
      const state = useFormState({ config, autoSave, init: { input: apiData, map: (v) => v } });
      async function autoSave(form: ObjectState<FormValue>) {
        autoSaveStub(form.changedValue);
        // Pretend to make an API call and update the local state
        setApiData((prevState) => ({ ...prevState, ...form.changedValue }));
        await Promise.resolve(1);
      }

      return (
        <div>
          <button
            data-testid="focusSetAndSaveField"
            onClick={() => {
              state.firstName.focus();
              state.firstName.set("Foo");
              state.firstName.maybeAutoSave();
              state.firstName.blur();
            }}
          />
          <button
            data-testid="focusSetAndSaveFieldLastName"
            onClick={() => {
              state.lastName.focus();
              state.lastName.set("Bar");
              state.lastName.maybeAutoSave();
            }}
          />
        </div>
      );
    }

    const r = await render(<TestComponent />);
    // And triggering the auto save behavior before awaiting the initial promise to resolve so we have pending changes.
    click(r.focusSetAndSaveField());
    click(r.focusSetAndSaveFieldLastName());
    // Awaits the promises for all methods triggered above
    await wait();
    // Then expect the auto save to only have been called twice. Once with each changedValues.
    expect(autoSaveStub).toBeCalledTimes(2);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo" });
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", lastName: "Bar" });
  });
});

const authorConfig: ObjectConfig<AuthorInput> = {
  id: { type: "value" },
  firstName: { type: "value" },
  lastName: { type: "value" },
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

/** Emulates a user focusing and then blurring a field. */
function focusAndBlur(state: FieldState<any, any>): void {
  state.focus();
  state.blur();
}
