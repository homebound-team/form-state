import { click, clickAndWait, render, typeAndWait, wait } from "@homebound/rtl-utils";
import { act } from "@testing-library/react";
import { reaction } from "mobx";
import { Observer } from "mobx-react";
import { useMemo, useState } from "react";
import { ObjectConfig } from "src/config";
import { ObjectState } from "src/fields/objectField";
import { FieldState } from "src/fields/valueField";
import { TextField } from "src/FormStateApp";
import { AuthorInput } from "src/formStateDomain";
import { required } from "src/rules";
import { useFormState } from "./useFormState";

describe("useFormState", () => {
  it("calls init.map if init.input is defined", async () => {
    // Given a component
    function TestComponent() {
      type FormValue = Pick<AuthorInput, "firstName">;
      const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
      // And we have query data that may or may not be defined
      const data: { firstName: string } | undefined = { firstName: "bob" };
      const form = useFormState({
        config,
        // Then the lambda is passed the "de-undefined" data, i.e. `d.firstName` is not a compile error
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
    // And it's using a class/mobx proxy as the basis for the data
    class AuthorRow {
      constructor(public firstName: string, public lastName: string) {}
      get fullName() {
        return this.firstName + " " + this.lastName;
      }
    }
    function TestComponent() {
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
    await clickAndWait(r.add);
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
    await clickAndWait(r.setFirst);
    // When autoSave didn't infinite loop
    expect(autoSaves).toEqual(1);
  });

  it("batches calls to auto-save", async () => {
    // Given a component
    const autoSave = jest.fn();
    function TestComponent() {
      type FormValue = AuthorInput;
      const config: ObjectConfig<FormValue> = authorConfig;
      const data = { firstName: "f1", lastName: "f1" };
      const form = useFormState({
        config,
        init: data,
        autoSave: (form) => autoSave(form.changedValue),
      });
      return (
        <div>
          <button
            data-testid="set"
            onClick={() => {
              // And it sets two fields in a single callback
              form.firstName.set("f2");
              form.lastName.set("l2");
            }}
          />
        </div>
      );
    }
    const r = await render(<TestComponent />);
    // When we change both
    await clickAndWait(r.set);
    // Then we only call autoSave once
    expect(autoSave).toBeCalledTimes(1);
    expect(autoSave).toBeCalledWith({ firstName: "f2", lastName: "l2" });
  });

  it("queues changes for auto save if a save is already in progress", async () => {
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
        const changed = form.changedValue;
        // Pretend to make an API call and update the local state
        await Promise.resolve(1);
        setApiData((prevState) => ({ ...prevState, ...changed }));
      }

      return (
        <div>
          <div data-testid="name">
            {apiData.firstName} {apiData.lastName}
          </div>
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
    // And triggering the auto save behavior before awaiting the initial promise to
    // resolve so we have pending changes.
    click(r.focusSetAndSaveField(), { allowAsync: true });
    // Let the initial autoSave be called
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(r.name()).toHaveTextContent("Brandon Dow");
    expect(autoSaveStub).toBeCalledTimes(1);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo" });

    // And while that is in flight, trigger another user action
    click(r.focusSetAndSaveFieldLastName(), { allowAsync: true });
    // (Use `wait` so that our timer flushes before the Promise.resolve(1) is ran)
    await wait();

    // Then expect the auto save to only have been called twice. Once with each changedValues.
    expect(autoSaveStub).toBeCalledTimes(2);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo" });
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", lastName: "Bar" });
  });

  it("calls autoSave with results of calculations in addRules", async () => {
    const autoSaveStub = jest.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName" | "lastName">;
    const config: ObjectConfig<FormValue> = {
      id: { type: "value" },
      firstName: { type: "value" },
      lastName: { type: "value" },
    };

    // Given a component that is using autoSave
    function TestComponent() {
      const fs = useFormState({
        config,
        addRules(fs) {
          // And also has calculated values
          reaction(
            () => fs.firstName.value,
            (curr) => (fs.lastName.value = curr),
          );
        },
        autoSave: (fs) => autoSaveStub(fs.changedValue),
        init: { id: "a:1" },
      });
      return <TextField field={fs.firstName} />;
    }

    const r = await render(<TestComponent />);
    // When the user sets one field
    await typeAndWait(r.firstName, "first");
    // Then we only called autoSave once
    expect(autoSaveStub).toBeCalledTimes(1);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "first", lastName: "first" });
  });

  it("sets loading if opts.loading is true", async () => {
    // Given a component
    type FormValue = Pick<AuthorInput, "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent({ loading }: { loading: boolean }) {
      const form = useFormState({ config, loading });
      return <Observer>{() => <div data-testid="loading">{String(form.loading)}</div>}</Observer>;
    }
    // And we initially pass in `init.query.loading: true`
    const r = await render(<TestComponent loading={true} />);
    // Then the form is marked as loading
    expect(r.loading()).toHaveTextContent("true");
    // And when the query is not loading
    await r.rerender(<TestComponent loading={false} />);
    // Then the form is marked as not loading
    expect(r.loading()).toHaveTextContent("false");
  });

  it("sets loading if input.data is undefined", async () => {
    // Given a component
    type FormValue = Pick<AuthorInput, "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent({ data }: { data: AuthorInput | undefined }) {
      const form = useFormState({ config, init: { input: data, map: (d) => d } });
      return <Observer>{() => <div data-testid="loading">{String(form.loading)}</div>}</Observer>;
    }
    // And we initially pass in `init.input: undefined`
    const r = await render(<TestComponent data={undefined} />);
    // Then the form is marked as loading
    expect(r.loading()).toHaveTextContent("true");
    // And when the data is no longer undefined
    await r.rerender(<TestComponent data={{ firstName: "first" }} />);
    // Then the form is marked as not loading
    expect(r.loading()).toHaveTextContent("false");
  });

  it("sets loading if query.loading is true", async () => {
    // Given a component
    type FormValue = Pick<AuthorInput, "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent({ loading, data }: { loading: boolean; data: AuthorInput | undefined }) {
      const form = useFormState({ config, init: { query: { data, loading, error: null }, map: (d) => d } });
      return <Observer>{() => <div data-testid="loading">{String(form.loading)}</div>}</Observer>;
    }
    // And we initially pass in `init.query.loading: true`
    const r = await render(<TestComponent loading={true} data={undefined} />);
    // Then the form is marked as loading
    expect(r.loading()).toHaveTextContent("true");
    // And when the query is not loading
    await r.rerender(<TestComponent loading={false} data={{ firstName: "first" }} />);
    // Then the form is marked as not loading
    expect(r.loading()).toHaveTextContent("false");
  });

  it("treats the id changing as a whole new entity instead of a delete", async () => {
    type FormValue = Pick<AuthorInput, "id" | "firstName">;
    const config: ObjectConfig<FormValue> = { firstName: { type: "value" } };
    function TestComponent() {
      // Given an initial author a1
      const [author, setAuthor] = useState<AuthorInput>({ id: "a:1", firstName: "a1" });
      const form = useFormState({ config, init: { input: author, map: (a) => a } });
      return (
        <Observer>
          {() => (
            <div>
              <div data-testid="value">{String(form.firstName.value)}</div>
              <div data-testid="dirty">{String(form.firstName.dirty)}</div>
              <div data-testid="originalValue">{String(form.firstName.originalValue)}</div>
              <div data-testid="objectValue">{String(form.value.firstName)}</div>
              <div data-testid="a1" onClick={() => setAuthor({ id: "a:1", firstName: "a1" })} />
              <div data-testid="a2" onClick={() => setAuthor({ id: "a:2", firstName: undefined })} />
            </div>
          )}
        </Observer>
      );
    }
    const r = await render(<TestComponent />);
    // And the value is initially a1/and not dirty
    expect(r.value()).toHaveTextContent("a1");
    expect(r.dirty()).toHaveTextContent("false");
    expect(r.originalValue()).toHaveTextContent("a1");
    expect(r.objectValue()).toHaveTextContent("a1");
    // When we switch to a completely separate author
    click(r.a2);
    // Then it switches to the next author
    expect(r.value()).toHaveTextContent("undefined");
    // And the field is not dirty (which had been the case before this bug fix)
    expect(r.dirty()).toHaveTextContent("false");
    expect(r.originalValue()).toHaveTextContent("undefined");
    expect(r.objectValue()).toHaveTextContent("undefined");
    // And when we switch back to the original author
    click(r.a1);
    // It again restores the value and does not think an edit was WIP
    expect(r.value()).toHaveTextContent("a1");
    expect(r.dirty()).toHaveTextContent("false");
    expect(r.originalValue()).toHaveTextContent("a1");
    expect(r.objectValue()).toHaveTextContent("a1");
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
function focusAndBlur(state: FieldState<any>): void {
  state.focus();
  state.blur();
}
