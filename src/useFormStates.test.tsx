import { click, clickAndWait, render, wait } from "@homebound/rtl-utils";
import { useMemo, useState } from "react";
import { ObjectConfig, ObjectState, required } from "src/formState";
import { AuthorInput } from "src/formStateDomain";
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
      const { getObjectState } = useFormStates<FormValue, FormValue>({
        config,
        autoSave,
        getId: (o) => o.id!,
      });

      return (
        <div>
          <ChildComponent os={getObjectState({ id: "a:1", firstName: "Brandon" })} />
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

    // Given a component using `getObjectState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Brandon" });
      const { getObjectState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      // Memoize an original for comparing the update against.
      const originalState = useMemo(() => getObjectState(apiData), []);
      const state = getObjectState(apiData);

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

    // Given a component using `getObjectState` for lazily creating ObjectStates
    function TestComponent() {
      const [apiData, setApiData] = useState<FormValue>({ id: "a:1", firstName: "Tony", lastName: "Stark" });
      const [apiData2, setApiData2] = useState<FormValue>({ id: "a:2", firstName: "Steve", lastName: "Rogers" });

      const { getObjectState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      const state = getObjectState(apiData);
      const state2 = getObjectState(apiData2);

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
    // Then expect the auto save to only have been called three times. Once with each set of changedValues.
    expect(autoSaveStub).toBeCalledTimes(3);
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", firstName: "Foo" });
    expect(autoSaveStub).toBeCalledWith({ id: "a:1", lastName: "Bar" });
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
      const { getObjectState } = useFormStates<FormValue, FormValue>({ config, autoSave, getId: (o) => o.id! });
      // Memoize an original for comparing the update against.
      const originalState = useMemo(() => getObjectState(apiData), []);
      const state = getObjectState(apiData);

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
});