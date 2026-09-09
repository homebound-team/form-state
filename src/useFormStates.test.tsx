import { click, clickAndWait, render, typeAndWait, wait } from "@homebound/rtl-utils";
import { act, renderHook } from "@testing-library/react";
import { reaction } from "mobx";
import { useMemo, useState } from "react";
import { type ObjectConfig } from "src/config";
import { type ObjectState } from "src/fields/objectField";
import { TextField } from "src/FormStateApp";
import { type AuthorInput } from "src/formStateDomain";
import { required } from "src/rules";
import { useFormStates } from "src/useFormStates";

describe("useFormStates", () => {
  it("can lazily create form states", async () => {
    const autoSave = vi.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName">;

    // Given a parent and child component, where the formState is created only for the child component.
    function ChildComponent({ os }: { os: ObjectState<FormValue> }) {
      return <div data-testid="firstName">{os.firstName.value}</div>;
    }
    function TestComponent() {
      const config: ObjectConfig<FormValue> = { id: { type: "value" }, firstName: { type: "value" } };
      const { getFormState } = useFormStates<FormValue, FormValue>({
        config,
        autoSave,
        getId: (o) => o.id!,
      });

      return (
        <div>
          <ChildComponent os={getFormState({ id: "a:1", firstName: "Brandon" })} />
        </div>
      );
    }
    const r = await render(<TestComponent />);
    // And the child component has defined state
    expect(r.firstName).toHaveTextContent("Brandon");
  });

  it("can update existing object state from cache with new values", async () => {
    const autoSave = vi.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName">;
    const config: ObjectConfig<FormValue> = { id: { type: "value" }, firstName: { type: "value" } };

    // Given a component using `getFormState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Brandon" });
      const { getFormState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      // Memoize an original for comparing the update against, so deliberately ignore `apiData` changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const originalState = useMemo(() => getFormState(apiData), [getFormState]);
      const state = getFormState(apiData);

      return (
        <div>
          <div data-testid="firstName">{state.firstName.value}</div>
          <div data-testid="statesEqual">{JSON.stringify(state === originalState)}</div>
          <button
            data-testid="updateApiData"
            onClick={() => setApiData((prevState) => ({ ...prevState, firstName: "Bob" }))}
          />
        </div>
      );
    }

    const r = await render(<TestComponent />);
    // And the initial values for the form state display
    expect(r.firstName).toHaveTextContent("Brandon");
    expect(r.statesEqual).toHaveTextContent("true");
    // When updating the API data
    await clickAndWait(r.updateApiData);
    // Then the new value is shown in the component
    expect(r.firstName).toHaveTextContent("Bob");
    // And the two states are using the same reference
    expect(r.statesEqual).toHaveTextContent("true");
  });

  it("can queue up changes for auto save if a save is already in progress - works across multiple states", async () => {
    const autoSaveStub = vi.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName" | "lastName">;
    const config: ObjectConfig<FormValue> = {
      id: { type: "value" },
      firstName: { type: "value" },
      lastName: { type: "value" },
    };

    // Given a component using `getFormState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Tony", lastName: "Stark" });
      const [apiData2, setApiData2] = useState<FormValue>({ id: "a:2", firstName: "Steve", lastName: "Rogers" });

      const { getFormState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      const state = getFormState(apiData);
      const state2 = getFormState(apiData2);

      async function autoSave(form: ObjectState<FormValue>) {
        autoSaveStub(form.changedValue);
        // Pretend to make an API call and update the local state
        if (form.id.value === "a:1") {
          setApiData((prevState) => ({ ...prevState, ...form.changedValue }));
        } else {
          setApiData2((prevState) => ({ ...prevState, ...form.changedValue }));
        }
        await Promise.resolve(1);
      }

      return (
        <div>
          <div data-testid="firstName">{state.firstName.value}</div>
          <button
            data-testid="focusSetAndSaveField"
            onClick={() => {
              state.firstName.focus();
              state.firstName.set("Foo");
              state.firstName.maybeAutoSave();
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
          <button
            data-testid="focusSetAndSaveField2"
            onClick={() => {
              state2.lastName.focus();
              state2.lastName.set("Bar");
              state2.lastName.maybeAutoSave();
            }}
          />
        </div>
      );
    }

    const r = await render(<TestComponent />);
    // And triggering the auto save behavior before awaiting the initial promise to resolve so we have pending changes.
    click(r.focusSetAndSaveField);
    click(r.focusSetAndSaveFieldLastName);
    click(r.focusSetAndSaveField2);
    // Awaits the promises for all methods triggered above
    await wait();
    // Then expect the auto save to only have been called two times. Once with each set of changedValues.
    expect(autoSaveStub).toBeCalledTimes(2);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo", lastName: "Bar" });
    expect(autoSaveStub).toBeCalledWith({ id: "a:2", lastName: "Bar" });
  });

  it("clears out cache if configuration changes", async () => {
    const autoSave = vi.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName">;
    // Given a component with stable API data.
    const apiData = { id: "a:1", firstName: "Brandon", lastName: "Dow" };
    // And two sets of configurations
    const originalConfig: ObjectConfig<FormValue> = { id: { type: "value" }, firstName: { type: "value" } };
    const updatedConfig: ObjectConfig<FormValue> = {
      id: { type: "value" },
      firstName: { type: "value", rules: [required] },
    };

    function TestComponent() {
      const [config, setConfig] = useState(originalConfig);
      const { getFormState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      // Memoize an original for comparing the update against.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const originalState = useMemo(() => getFormState(apiData), []);
      const state = getFormState(apiData);

      return (
        <div>
          <div data-testid="statesEqual">{JSON.stringify(state === originalState)}</div>
          <button data-testid="updateConfig" onClick={() => setConfig(updatedConfig)} />
        </div>
      );
    }

    // When rendered with the original configuration
    const r = await render(<TestComponent />);
    // Then the two form-states generated are equal
    expect(r.statesEqual).toHaveTextContent("true");
    // When updating the configuration object
    click(r.updateConfig);
    // Then the two form-states are no longer equal.
    expect(r.statesEqual).toHaveTextContent("false");
  });

  it("calls addRules once per form state", async () => {
    // Given a user wants to use addRules
    const addRules = vi.fn();

    function TestComponent() {
      const config: ObjectConfig<FormValue> = { id: { type: "value" }, firstName: { type: "value" } };
      const { getFormState } = useFormStates<FormValue, FormValue>({
        config,
        addRules,
        getId: (o) => o.id!,
      });
      return (
        <div>
          {/* And pretend this getFormState was called in multiple renders. */}
          <ChildComponent os={getFormState({ id: "a:1", firstName: "Brandon" })} />
          <ChildComponent os={getFormState({ id: "a:1", firstName: "Brandon" })} />
        </div>
      );
    }
    // When we render
    await render(<TestComponent />);
    // Then addRules was only called once
    expect(addRules).toHaveBeenCalledTimes(1);
  });

  it("calls autoSave with results of calculations in addRules", async () => {
    // Given a user wants to use auto save
    const autoSave = vi.fn();

    function TestComponent() {
      const { getFormState } = useFormStates({
        config,
        getId: (o) => o.id!,
        addRules(fs) {
          // And they have a reactive true that calculates last name
          reaction(
            () => fs.firstName.value,
            (curr) => {
              fs.lastName.set(curr);
            },
          );
        },
        async autoSave(fs) {
          autoSave(fs.changedValue);
        },
      });
      return <TextField field={getFormState({ id: "a:1", firstName: "Brandon" }).firstName} />;
    }
    // When we render
    const r = await render(<TestComponent />);
    // And update the firstName
    await typeAndWait(r.firstName, "first");
    // Then autoSave was called once with both input+calc'd values
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(autoSave).toHaveBeenCalledWith({ id: "a:1", firstName: "first", lastName: "first" });
  });

  it("can set readOnly via the hook opt", async () => {
    // Given a test component
    function TestComponent({ readOnly }: { readOnly: boolean }) {
      const { getFormState } = useFormStates({
        config,
        getId: (o) => o.id!,
        // And it passes readOnly directly to useFormStates
        readOnly,
      });
      return <ChildComponent os={getFormState({ id: "a:1", firstName: "Brandon" })} />;
    }
    // When we render
    const r = await render(<TestComponent readOnly={true} />);
    // Then it's read only
    expect(r.firstName).toHaveAttribute("data-readonly", "true");
    // And when we rerender
    await r.rerender(<TestComponent readOnly={false} />);
    // Then it's not read only
    expect(r.firstName).toHaveAttribute("data-readonly", "false");
  });

  it("can set readOnly via the getFormState function", async () => {
    // Given a test component
    function TestComponent({ readOnly }: { readOnly: boolean }) {
      const { getFormState } = useFormStates({
        config,
        getId: (o) => o.id!,
      });
      // And it passes readOnly directly to getFormState
      return <ChildComponent os={getFormState({ id: "a:1", firstName: "Brandon" }, { readOnly })} />;
    }
    // When we render
    const r = await render(<TestComponent readOnly={true} />);
    // Then it's read only
    expect(r.firstName).toHaveAttribute("data-readonly", "true");
    // And when we rerender
    await r.rerender(<TestComponent readOnly={false} />);
    // Then it's not read only
    expect(r.firstName).toHaveAttribute("data-readonly", "false");
  });

  it("does not lose a second hook's auto-save while another hook's save is in flight", async () => {
    // Given two independent `useFormStates` hooks on the same page
    // And hook A's save will stay in flight until we resolve it
    let resolveA: () => void = () => {};
    const autoSaveA = vi.fn(() => new Promise<void>((resolve) => (resolveA = resolve)));
    // And hook B's save resolves right away
    const autoSaveB = vi.fn(() => Promise.resolve());
    function TestComponent() {
      const hookA = useFormStates<FormValue, FormValue>({ config, autoSave: autoSaveA, getId: (o) => o.id! });
      const hookB = useFormStates<FormValue, FormValue>({ config, autoSave: autoSaveB, getId: (o) => o.id! });
      const a = hookA.getFormState({ id: "a:1", firstName: "a1" });
      const b = hookB.getFormState({ id: "a:2", firstName: "b1" });
      return (
        <div>
          <button data-testid="editA" onClick={() => a.firstName.set("a2")} />
          <button data-testid="editB" onClick={() => b.firstName.set("b2")} />
        </div>
      );
    }
    const r = await render(<TestComponent />);
    // When hook A's row is edited and its auto-save starts
    await clickAndWait(r.editA);
    expect(autoSaveA).toBeCalledTimes(1);
    // And hook B's row is edited while hook A's save is still in flight
    await clickAndWait(r.editB);
    // Then hook B's auto-save is not blocked by hook A
    expect(autoSaveB).toBeCalledTimes(1);
    // And when hook A's save finishes
    resolveA();
    await wait();
    // Then nothing was saved twice
    expect(autoSaveA).toBeCalledTimes(1);
    expect(autoSaveB).toBeCalledTimes(1);
  });

  it("autosaves an edit back to the original value after an in-flight save is acknowledged", async () => {
    // Given a Bob form with a stable configuration
    type FormValue = { id: string; name: string };
    const config: ObjectConfig<FormValue> = { id: { type: "value" }, name: { type: "value" } };
    // And two save responses that remain pending until explicitly resolved
    const firstResponse = Promise.withResolvers<FormValue>();
    const secondResponse = Promise.withResolvers<FormValue>();
    const submitted: Partial<FormValue>[] = [];
    const autoSave = vi
      .fn()
      .mockImplementationOnce(async (form: ObjectState<FormValue>) => {
        submitted.push(form.changedValue);
        hook.rerender(await firstResponse.promise);
      })
      .mockImplementationOnce(async (form: ObjectState<FormValue>) => {
        submitted.push(form.changedValue);
        hook.rerender(await secondResponse.promise);
      });
    // And the hook refreshes the cached form from each new input
    const hook = renderHook(
      (input: FormValue) => useFormStates({ config, autoSave, getId: (o: FormValue) => o.id }).getFormState(input),
      { initialProps: { id: "a:1", name: "Bob" } },
    );
    const form = hook.result.current;
    expect(form.name.value).toEqual("Bob");
    expect(form.name.originalValue).toEqual("Bob");
    expect(form.dirty).toEqual(false);

    // When Fred is submitted and its response stays in flight
    act(() => form.name.set("Fred"));
    await wait();
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(submitted).toEqual([{ id: "a:1", name: "Fred" }]);

    // And the user edits back to Bob, which is locally clean
    act(() => form.name.set("Bob"));
    expect(form.name.value).toEqual("Bob");
    expect(form.name.originalValue).toEqual("Bob");
    expect(form.dirty).toEqual(false);

    // And a stale cache refresh still reports Bob before Fred is acknowledged
    hook.rerender({ id: "a:1", name: "Bob" });
    expect(form.name.value).toEqual("Bob");
    expect(form.name.originalValue).toEqual("Bob");
    expect(form.dirty).toEqual(false);
    expect(autoSave).toHaveBeenCalledTimes(1);

    // When the first save callback refreshes the hook with Fred's acknowledgement
    await act(async () => {
      firstResponse.resolve({ id: "a:1", name: "Fred" });
      await firstResponse.promise;
    });
    // Then Bob is preserved and becomes dirty against the acknowledged Fred
    expect(form.name.value).toEqual("Bob");
    expect(form.name.originalValue).toEqual("Fred");
    expect(form.dirty).toEqual(true);

    // And Bob is autosaved without another user edit
    await wait();
    expect(autoSave).toHaveBeenCalledTimes(2);
    expect(submitted).toEqual([
      { id: "a:1", name: "Fred" },
      { id: "a:1", name: "Bob" },
    ]);

    // When the second save callback refreshes the hook with Bob's acknowledgement
    await act(async () => {
      secondResponse.resolve({ id: "a:1", name: "Bob" });
      await secondResponse.promise;
    });
    // Then the form is clean and no third save is submitted
    await wait();
    expect(form.name.value).toEqual("Bob");
    expect(form.name.originalValue).toEqual("Bob");
    expect(form.dirty).toEqual(false);
    expect(autoSave).toHaveBeenCalledTimes(2);
  });
});

type FormValue = Pick<AuthorInput, "id" | "firstName">;
type FirstAndLastValue = Pick<AuthorInput, "id" | "firstName" | "lastName">;

const config: ObjectConfig<FirstAndLastValue> = {
  id: { type: "value" },
  firstName: { type: "value" },
  lastName: { type: "value" },
};

function ChildComponent({ os }: { os: ObjectState<FormValue> }) {
  return (
    <div data-testid="firstName" data-readonly={os.firstName.readOnly}>
      {os.firstName.value}
    </div>
  );
}
