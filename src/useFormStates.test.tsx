import { click, clickAndWait, render, typeAndWait, wait } from "@homebound/rtl-utils";
import { reaction } from "mobx";
import { useMemo, useState } from "react";
import { ObjectConfig } from "src/config";
import { ObjectState } from "src/fields/objectField";
import { TextField } from "src/FormStateApp";
import { AuthorInput } from "src/formStateDomain";
import { required } from "src/rules";
import { useFormStates } from "src/useFormStates";

describe("useFormStates", () => {
  it("can lazily create form states", async () => {
    const autoSave = jest.fn();
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
    expect(r.firstName()).toHaveTextContent("Brandon");
  });

  it("can update existing object state from cache with new values", async () => {
    const autoSave = jest.fn();
    type FormValue = Pick<AuthorInput, "id" | "firstName">;
    const config: ObjectConfig<FormValue> = { id: { type: "value" }, firstName: { type: "value" } };

    // Given a component using `getFormState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Brandon" });
      const { getFormState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      // Memoize an original for comparing the update against.
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
    expect(r.firstName()).toHaveTextContent("Brandon");
    expect(r.statesEqual()).toHaveTextContent("true");
    // When updating the API data
    await clickAndWait(r.updateApiData());
    // Then the new value is shown in the component
    expect(r.firstName()).toHaveTextContent("Bob");
    // And the two states are using the same reference
    expect(r.statesEqual()).toHaveTextContent("true");
  });

  it("can queue up changes for auto save if a save is already in progress - works across multiple states", async () => {
    const autoSaveStub = jest.fn();
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
    click(r.focusSetAndSaveField());
    click(r.focusSetAndSaveFieldLastName());
    click(r.focusSetAndSaveField2());
    // Awaits the promises for all methods triggered above
    await wait();
    // Then expect the auto save to only have been called two times. Once with each set of changedValues.
    expect(autoSaveStub).toBeCalledTimes(2);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo", lastName: "Bar" });
    expect(autoSaveStub).toBeCalledWith({ id: "a:2", lastName: "Bar" });
  });

  it("clears out cache if configuration changes", async () => {
    const autoSave = jest.fn();
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
    expect(r.statesEqual()).toHaveTextContent("true");
    // When updating the configuration object
    click(r.updateConfig);
    // Then the two form-states are no longer equal.
    expect(r.statesEqual()).toHaveTextContent("false");
  });

  it("calls addRules once per form state", async () => {
    // Given a user wants to use addRules
    const addRules = jest.fn();

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
    const autoSave = jest.fn();

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
    await typeAndWait(r.firstName(), "first");
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
    expect(r.firstName()).toHaveAttribute("data-readonly", "true");
    // And when we rerender
    await r.rerender(<TestComponent readOnly={false} />);
    // Then it's not read only
    expect(r.firstName()).toHaveAttribute("data-readonly", "false");
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
    expect(r.firstName()).toHaveAttribute("data-readonly", "true");
    // And when we rerender
    await r.rerender(<TestComponent readOnly={false} />);
    // Then it's not read only
    expect(r.firstName()).toHaveAttribute("data-readonly", "false");
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
