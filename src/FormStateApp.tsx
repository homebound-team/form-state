import { Observer } from "mobx-react";
import { AuthorInput, BookInput } from "src/formStateDomain";
import { FieldState, f, useFormState } from "src/index";

export function FormStateApp() {
  const formState = useFormState({
    config: formConfig,
    // Simulate getting the initial form state back from a server call
    init: {
      input: {
        firstName: "a1",
        books: [...Array(2)].map((_, i) => ({
          title: `b${i}`,
          classification: { number: `10${i + 1}`, category: `Test Category ${i}` },
        })),
      },
    },
    addRules(state) {
      state.lastName.rules.push(() => {
        return state.firstName.value === state.lastName.value ? "Last name cannot equal first name" : undefined;
      });
    },
    async autoSave() {
      console.log("saving", formState.changedValue);
    },
  });

  return (
    <Observer>
      {() => (
        <div className="App">
          <header className="App-header">
            <div>
              <b>Author</b>
              <TextField field={formState.firstName} />
              <TextField field={formState.lastName} />
            </div>

            <div>
              <strong>
                Books <button onClick={() => formState.books.add({})}>Add book</button>
              </strong>
              {formState.books.rows?.map((row, i) => {
                return (
                  <div key={i}>
                    Book {i}
                    <button onClick={() => formState.books.remove(row.value)}>X</button>
                    <TextField field={row.title} />
                  </div>
                );
              })}
            </div>

            <div>
              <strong>Rows</strong>
              <table cellPadding="4px">
                <thead>
                  <tr>
                    <th>touched</th>
                    <th>valid</th>
                    <th>dirty</th>
                    <th>errors</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formState.books.touched.toString()}</td>
                    <td>{formState.books.valid.toString()}</td>
                    <td>{formState.books.dirty.toString()}</td>
                    <td>{formState.books.errors}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <strong>Form</strong>
              <table cellPadding="4px">
                <thead>
                  <tr>
                    <th>touched</th>
                    <th>valid</th>
                    <th>dirty</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formState.touched.toString()}</td>
                    <td>{formState.valid.toString()}</td>
                    <td>{formState.dirty.toString()}</td>
                  </tr>
                </tbody>
              </table>

              <div>
                <button data-testid="touch" onClick={() => (formState.touched = !formState.touched)}>
                  touch
                </button>
                <button data-testid="revertChanges" onClick={() => formState.revertChanges()}>
                  revert
                </button>
                <button data-testid="commitChanges" onClick={() => formState.commitChanges()}>
                  commit
                </button>
                <button data-testid="set" onClick={() => formState.set({ firstName: "a2" })}>
                  set
                </button>
              </div>
            </div>
          </header>
        </div>
      )}
    </Observer>
  );
}

// Configure the fields/behavior for AuthorInput's fields
const formConfig = f.config<AuthorInput>({
  firstName: f.value().req(),
  lastName: f.value().readOnly(),
  books: f
    .list<BookInput>({
      title: f.value().req(),
    })
    .rule(({ value }) => (value.length === 0 ? "Empty" : undefined)),
});

export function TextField(props: { field: FieldState<string | null | undefined> }) {
  const { field } = props;
  // Somewhat odd: input won't update unless we use <Observer>, even though our
  // parent uses `<Observer>`
  return (
    <Observer>
      {() => (
        <div>
          <span>{field.key}:</span>
          <div>
            <input
              data-testid={field.key}
              value={field.value || ""}
              onBlur={() => field.blur()}
              readOnly={field.readOnly}
              onChange={(e) => {
                field.set(e.target.value);
              }}
            />
          </div>
          <table cellPadding="4px">
            <thead>
              <tr>
                <th>touched</th>
                <th>valid</th>
                <th>dirty</th>
                <th>readOnly</th>
                <th>errors</th>
                <th>original value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-testid={`${field.key}_touched`}>{field.touched.toString()}</td>
                <td data-testid={`${field.key}_valid`}>{field.valid.toString()}</td>
                <td data-testid={`${field.key}_dirty`}>{field.dirty.toString()}</td>
                <td data-testid={`${field.key}_readOnly`}>{field.readOnly.toString()}</td>
                <td data-testid={`${field.key}_errors`}>{field.errors}</td>
                <td data-testid={`${field.key}_original`}>{field.originalValue}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Observer>
  );
}
