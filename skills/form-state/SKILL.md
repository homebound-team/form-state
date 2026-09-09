---
name: form-state
description: >
  Best practices for @homebound/form-state, a headless MobX-based form library. Use whenever you
  build, edit, or debug a form: defining an ObjectConfig, calling useFormState (single record) or
  useFormStates (one form per table row), wiring Bound* fields, validation (rules / required /
  addRules), saving via changedValue, form lifecycle (canSave / update / commitChanges /
  revertChanges / dirty / valid / touched), readOnly/loading, or MobX reactivity gotchas (Observer /
  useComputed). Triggers: useFormState, useFormStates, ObjectConfig, ObjectState, FieldState,
  BoundTextField/BoundSelectField/etc., changedValue, autoSave, formState.
---

# form-state

`@homebound/form-state` is a headless, MobX-based form library. It buffers between the canonical
server data and the user's work-in-progress edits, so every field gets `value`/`dirty`/`touched`/
`errors`/`valid` state and the UI can be "one line per field" via a component library's `Bound*`
components.

Repo & docs: https://github.com/homebound-team/form-state (see `README.md` and the in-repo sample
app `src/FormStateApp.tsx`). The library is headless — it produces a `FieldState` interface that a
component library binds to. [Beam](https://github.com/homebound-team/beam) is the reference
implementation of the `Bound*` components referenced throughout this guide; substitute your own.

## The three shapes (mental model)

form-state maps between three types. Getting these right is 80% of using the library well:

1. **Input type `I`** — the query _output_ fragment you load (e.g. an `AuthorFragment` from GraphQL,
   or any REST/store shape).
2. **Form type `T`** — the flat, editable shape, kept as close as possible to the mutation _input_
   (`SaveAuthorInput`). This is what you write an `ObjectConfig<T>` for.
3. **Wire type** — the mutation payload. You get it from `formState.changedValue` (only dirty
   fields + id) and pass it to the save call.

`init.map` converts `I → T`. `changedValue` extracts `T → wire`. Don't hand-map form controls
back to server data — that's the whole point of the library. (See "The Three Shapes Mental Model"
in `README.md`.)

## Config style

There are two equivalent ways to write a config; pick one and stay consistent within a file:

- **Plain `ObjectConfig<T>` object literals** — explicit and dependency-free; used throughout this
  guide. Recommended as the default: it reads top-to-bottom and needs no builder knowledge.
- **The `f.*` builder DSL** (`f.config()`, `f.value().req()`, `f.list()`, …) — a fluent, Zod-ish
  builder exported as `f`; used by the README and `src/FormStateApp.tsx`. Handy when you like the
  chaining ergonomics.

Both compile to the same runtime config. General conventions that apply either way:

- **Declare the config as a module-level `const`** (paired with the form type and any `mapToForm`
  helper), typically at the bottom of the file. Reach for `useMemo` **only** when a rule/`readOnly`
  depends on runtime state, and a **factory function** `(opts) => ObjectConfig<T>` when it depends
  on props/permissions. `useFormStates` in particular _requires_ a stable config (see below).
- **Derive the form type `T` from the mutation input** (`SaveXInput`) — directly, or via
  `Pick`/`Omit`, intersected with FE-only fields:
  `type FormValue = SaveXInput & { attachment?: ...; hasFoo: boolean }`.
- **Save with `formState.changedValue`**, gated by `if (formState.canSave()) { ... }`.
- **After a save you usually don't need to mark the form clean** — the store/cache update
  re-triggers `init.input`/`init.map` and resolves dirty state on the next render. Only reach for an
  explicit clear when timing matters (e.g. clearing dirty _synchronously_ before a `navigate()`), and
  when you do, prefer `formState.update(acked)` over deprecated `commitChanges()` (see
  [Lifecycle](#saving--lifecycle)).
- **Wrap raw `formState.*` reads (`.value`, `.dirty`, `.errors`, `.canSave()`) in `<Observer>`
  or `useComputed`.** `Bound*` components are already reactive and need no wrapper.

Import everything from `@homebound/form-state`: `useFormState`, `useFormStates`, `required`, `f`,
`createObjectState`, and the `ObjectConfig` / `ObjectState` / `FieldState` / `Rule` types.

## ObjectConfig reference

```ts
type FormValue = Pick<SaveAuthorInput, "id" | "firstName" | "lastName" | "cityId" | "bookIds">;

const formConfig: ObjectConfig<FormValue> = {
  id: { type: "value" },
  firstName: { type: "value", rules: [required] },
  lastName: { type: "value", rules: [required] },
  cityId: { type: "value" },
  bookIds: { type: "value" },
};
```

### Field kinds

| `type`       | when                                               | notes                                                         |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| `"value"`    | any primitive/enum/id/string[] field               | the default                                                   |
| `"list"`     | array of child objects (`books: Book[]`)           | needs child `config`; see below                               |
| `"object"`   | nested single object                               | needs child `config`; `reference: true` to send only its `id` |
| `"fragment"` | read-only data you want on the form but never send | ⚠️ snapshot bug, see gotchas                                  |

Enums and nested ids map to `"value"` fields holding the `.code`/`.id` string — flatten them in
`init.map` (e.g. `classification: a.classification?.code`, `cityId: a.city?.id`).

### `type: "value"` options (all optional)

| option                   | meaning                                                                | notes                                                                                   |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `rules: [required, ...]` | validation rules (see [Validation](#validation))                       | the common case                                                                         |
| `readOnly: boolean`      | field starts read-only; can be flipped at runtime                      | often `readOnly: !canEdit`                                                              |
| `computed: true`         | backed by a MobX computed; excluded from `reset`                       | for derived/aggregate fields                                                            |
| `isDeleteKey: true`      | this bool marks a list row as deleted (excluded from list validity)    | e.g. `delete: { type: "value", isDeleteKey: true }`                                     |
| `isReadOnlyKey: true`    | truthy value makes the whole containing entity read-only               | rare                                                                                    |
| `isIdKey: boolean`       | marks the id field (auto-true for `id`); always kept in `changedValue` | rely on the default for a field named `id`                                              |
| `isLocalOnly: true`      | ignore in dirty checks / never send                                    | for FE-only fields; alternatively add them to `T` and destructure out of `changedValue` |
| `strictOrder: false`     | array order doesn't affect dirty/changed                               | rare                                                                                    |

### `type: "list"` (nested collections)

```ts
attachments: {
  type: "list",
  // update: "incremental" → send only rows the user touched. Default "exhaustive" sends all rows
  // (safest; matches Joist) so unchanged rows aren't orphaned. "deep-exhaustive" also sends all fields.
  update: "incremental",
  config: {
    id: { type: "value" },
    asset: { type: "object", config: { id: { type: "value" }, s3Key: { type: "value" } } },
    op: { type: "value" },
  },
},
```

Child config can be inline (above) or a shared named const (`config: booksConfig`). Default the
`update` mode to exhaustive unless the backend expects only-touched rows. An `op` field (or legacy
`delete`/`remove`) in the child config implicitly enables incremental mode, following
[Joist's partial-update-apis](https://joist-orm.io/docs/features/partial-update-apis). See the
`books` list in `src/FormStateApp.tsx` and `src/useFormState.test.tsx`.

## useFormState (single record)

```ts
const formState = useFormState({
  config: formConfig,
  readOnly: !canEdit, // often from a permission/`canEdit.allowed`
  init: {
    input: author, // query fragment (or `query` for a QueryAndMap)
    map: (a) => ({
      // I → T; only called when input is defined
      id: a.id,
      firstName: a.firstName,
      cityId: a.city?.id,
    }),
    ifUndefined: { firstName: null }, // defaults for create mode (input undefined)
    onlyOnce: true, // freeze after first map (create modals w/ static seed)
  },
  autoSave: async (fs) => saveAuthor({ variables: { input: fs.changedValue } }),
});
```

### init

- **`init: { input, map }`** is the dominant form (existing record → form). `map` flattens the
  fragment; form-state `useMemo`s on `input` identity so `map` needn't be stable and needn't null-check.
- **`init: { query, map }`** passes the query result; form-state waits on `query.loading`.
- **`ifUndefined`** supplies create-mode defaults so one config serves add + edit.
- **`onlyOnce: true`** stops re-mapping when the input changes — use for create modals seeded with
  static data (can be conditional, e.g. only in modal mode).

See `src/useFormState.test.tsx` for `input`+`map`, `ifUndefined`, `query`, and `onlyOnce` cases.

### readOnly / loading

- `readOnly` from a permission (`!canEdit.allowed`), a precomputed `isReadonly`, or a mode/status
  (`mode === "view"`). It re-flows without rebuilding the form; nested forms can read
  `formState.readOnly` back out.
- `loading` suppresses the form until data arrives; usually `query.loading` or "edit mode but no
  record yet" (`!isNew && !record`). form-state also infers loading from `input === undefined` /
  `query.loading`, so only set it explicitly otherwise.

## useFormStates (one form per table row)

For tables where each row is its own mini-form with independent auto-save. Call the hook once at
table level; call `getFormState(row)` per row.

```ts
const { getFormState } = useFormStates<TodoForm, ToDoFragment>({
  config: formConfig,                       // stable module-level const (required)
  getId: (o) => o.id!,                      // identity to cache each row's ObjectState on
  map: (frag) => ({ id: frag.id, status: frag.status.code, /* I → T */ }),
  autoSave: async (os) => { await saveTodo(os.changedValue); },
  readOnly: !canEdit,                       // per-hook default; can be overridden per row
});

// In a table column render:
todo: (todo) => {
  const os = getFormState(todo);
  return <BoundSelectField field={os.status} options={statuses} />;
},
```

- **Config must be stable** (module-level const) — never inline/`useMemo`-less-ly rebuilt; rebuilding
  drops row caches and loses WIP edits.
- **`getId`** is almost always `(v) => v.id`. When a row has **no server id yet** (new/unsaved) or a
  **composite key**, synthesize a deterministic id from its natural key (e.g. `` `${parentId}:${childId}` ``)
  so form-state re-matches the same row when `init.input` re-maps and WIP edits survive.
- **Per-row `autoSave`**: read `os.changedValue`, fire a single-row mutation; the server-acked value
  flows back in via `map` to reset dirty. Concurrent row saves are serialized by the library.
- **Per-row read-only**: `getFormState(row, { readOnly: true })` overrides the hook-level default.
- Thread `getFormState` into your `createColumns`/`createRows` and list it in the `useMemo` deps.

See `src/useFormStates.test.tsx`.

## MobX reactivity (the #1 source of bugs)

form-state is MobX. `Bound*` components are self-reactive, but **any raw read of `formState.*`
in JSX or logic must be inside `<Observer>` or `useComputed`**, or it won't re-render.

```tsx
// ✅ Bound components — no wrapper needed
<BoundTextField label="Name" field={formState.firstName} />
<BoundSelectField field={formState.cityId} options={cities} />

// ✅ Raw reads → wrap in Observer (preferred: inline around just the reactive JSX)
<Observer>{() => <Button label="Save" disabled={!formState.dirty} />}</Observer>

// ✅ Deriving a value from fields → useComputed (from your component library, e.g. @homebound/beam)
const saveDisabled = useComputed(
  () => !formState.dirty || !formState.valid,
  [formState],
);
```

- `<Observer>` comes from `mobx-react`. Prefer **inline `<Observer>`** around the specific reactive
  JSX. Reach for the **`observer(function X...)` HOC** only when a whole small component (a card/row)
  reads `formState` in many places — common in tables.
- Use **`useComputed`** to derive a scalar/aggregate from fields, and (importantly) to keep a
  query **reactive** to form edits: `useComputed(() => [skip, variables], [f.a.value, f.b.value])`.
- Reads that need reactivity: `.value`, `.dirty`, `.valid`, `.errors`, `.canSave()`, `list.rows`.
  Note `formState.value.firstName` and `formState.firstName.value` are both reactive and return the
  same value (see "Internal Implementation Notes" in `README.md`).
- Tests configure `mobx` with `configure({ enforceActions: "never" })` (form-state mutates
  observables outside actions) — see `src/setupTests.ts`.

Common Bound components (reference implementation): `BoundSelectField`, `BoundNumberField`,
`BoundTextField`, `BoundMultiSelectField`, `BoundTextAreaField`, `BoundCheckboxField`,
`BoundDateField`, `BoundSwitchField`, `BoundRichTextField`, `BoundTreeSelectField`,
`BoundRadioGroupField`. Always pass the field proxy (`field={formState.foo}`), never `.value`.

## Saving & lifecycle

```ts
async function onSave() {
  if (!formState.canSave()) return; // validates + touches all fields
  const { id, attachments, ...input } = formState.changedValue; // peel off fields saved elsewhere
  const { data } = await saveThing({ variables: { input: { id, ...input } } });
  // No "mark clean" call needed: the store/cache update re-triggers init.input/map with the
  // server's values, resolving dirty state on the next render. Only add formState.update(acked)
  // when you must clear dirty *this* render — e.g. right before a navigate() (see below).
}
```

- **`changedValue`** — only dirty fields (+ id). The workhorse. Destructure out any FE-only fields
  and anything handled by a separate mutation before sending.
- **`canSave()`** — returns validity **and** marks fields touched so errors render. Use to guard
  saves and to disable the Save button.
- **Do you even need to "mark clean"? Usually not.** After the mutation, the store/cache update flows
  back through `init.input`/`init.map` with the server's latest values, and form-state resolves
  dirty/touched on the next render — no manual call. This is the default; only force an immediate
  clear when the timing matters. (See "Incremental changedValue/dirty Management" in `README.md`.)
- **`formState.update(ackedServerValue)`** — clears dirty **synchronously, this render** by re-running
  `init.map` on the server ack and reconciling field-by-field (it also picks up server-assigned ids).
  Needed only when you act _before_ the cache-driven re-render can happen — classically right before a
  `navigate()`, so the "unsaved changes?" guard doesn't fire. When you need a synchronous clear, use
  this over `commitChanges()`.
- **`commitChanges()`** — ⚠️ **deprecated**. It marks _all_ current changes as saved, so it can
  silently drop edits made while a save was in-flight. When you need a synchronous clear use
  `update(acked)` instead; otherwise let the cache refresh handle it.
- **`revertChanges()`** — discard edits (Cancel buttons, "leave page?" confirm). Also available
  per-field (`formState.foo.revertChanges()`).
- **`FieldState` / `ListFieldState`**: `field.set(v)`, `field.value`, `field.originalValue`,
  `field.dirty`, `field.blur()`, `list.rows`, `list.add(value, index?)`, `list.remove(indexOrValue)`.
- **`ValueAdapter` / `field.adapt(adapter)`** — wrap a field to convert its value type (e.g. cents ↔
  dollars) at the binding boundary. An alternative to converting in `init.map` + the save mapper; use
  whichever keeps the config clearest.

## Validation

- **`rules: [required]`** — `required` is imported from form-state. It rejects `undefined`, `null`,
  and empty/whitespace-only strings.
- **Custom rule** — `Rule<V>` = `({ value, key, originalValue }) => string | undefined`:
  ```ts
  totalPercent: { type: "value", rules: [({ value: v }) => (v !== 100 ? "Must equal 100%" : undefined)] }
  ```
- **`addRules(state)`** — for cross-field / conditional validation that the config DSL can't express.
  Push a rule onto a field that reads other fields' `.value`:
  ```ts
  addRules(state) {
    state.lastName.rules.push(() =>
      state.firstName.value === state.lastName.value ? "Last name cannot equal first name" : undefined,
    );
  }
  ```
  `addRules` doesn't need to be stable. In `useFormStates` it runs once per row (the place to wire
  per-row recalc). See `src/FormStateApp.tsx`.
- **Conditional required via `useMemo`'d config** — when required-ness depends on state:
  `phase: { type: "value", rules: !globalParentId ? [required] : [] }`.

## Testing & stories

- Component tests render the component with mocked data and drive it via `Bound*` fields — the
  form-state is exercised through the UI.
- For **isolated** field/component stories and tests, build an `ObjectState` directly with
  `createObjectState(config, initialValue)`:
  ```ts
  const fs = createObjectState<{ item: Maybe<string> }>({ item: { type: "value" } }, { item: undefined });
  // then <BoundSelectField field={fs.item} ... />
  ```

## Gotchas & anti-patterns

- ❌ **Don't read `formState.foo.value` (or `.dirty`/`.errors`) in JSX without `<Observer>`/`useComputed`.**
  It silently won't update. `Bound*` are the exception.
- ⚠️ **Don't name a form field with an `ObjectState`/`FieldState` member name** (`value`, `dirty`,
  `errors`, `touched`, `valid`, `changedValue`, `key`, `set`, `rows`, …) — the field access collides
  with the built-in member. For FE-only list-identity fields, use a name like `clientId`.
- ⚠️ **`type: "fragment"` snapshots on the first `init.map`** (often while loading, so it can freeze
  as empty) and never updates. If the value must refresh, model it as a `type: "list"` (or a plain
  `"value"`) instead.
- ⚠️ **`addRules` can't read MobX class computeds** — stash the derived value into a real form field
  (in `init.map`) so the rule can read it.
- ⚠️ **`useFormStates` config must be a stable module const** — rebuilding it drops row caches and
  loses WIP edits.
- ⚠️ **`revertChanges` on a list needs the full collection including soft-deleted rows** — model
  deletes with an `isDeleteKey` field rather than filtering rows out of the form.
- ⚠️ **Avoid calling `commitChanges()` manually with `autoSave`** — form-state warns about this
  because it can drop in-flight edits; let `init.map`/`update` reconcile instead.

## Quick reference

| I need to...                                           | Use                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Define a form's fields                                 | module-level `const config: ObjectConfig<T> = { ... }`                   |
| One form for a record                                  | `useFormState({ config, init: { input, map } })`                         |
| One form per table row                                 | `useFormStates({ config, getId, map, autoSave })` + `getFormState(row)`  |
| Bind a field to UI                                     | `<BoundTextField field={formState.foo} />`                               |
| Read a field value in JSX                              | wrap in `<Observer>` / derive via `useComputed`                          |
| Get the save payload                                   | `formState.changedValue`                                                 |
| Gate a save                                            | `if (formState.canSave()) { ... }`                                       |
| Clear dirty after save                                 | usually nothing — the store/cache refresh resolves it next render        |
| Clear dirty _synchronously_ (e.g. before `navigate()`) | `formState.update(acked)` (not `commitChanges()`)                        |
| Discard edits                                          | `formState.revertChanges()`                                              |
| Cross-field validation                                 | `addRules: (state) => state.foo.rules.push(...)`                         |
| Add/remove list rows                                   | `formState.rows.add(value)` / `.remove(indexOrValue)`                    |
| Save-disabled button                                   | `useComputed(() => !formState.dirty \|\| !formState.valid, [formState])` |
