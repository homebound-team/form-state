![npm](https://img.shields.io/npm/v/@homebound/form-state)
[![CircleCI](https://circleci.com/gh/homebound-team/form-state.svg?style=svg)](https://circleci.com/gh/homebound-team/form-state)

# form-state

form-state is a headless form state management library, built on top of mobx.

It acts as a buffer between the canonical data (i.e. the server-side data, or your app's GraphQL/Redux/etc. global store) and the user's WIP data that is being actively mutated in form fields (which is "too chatty"/WIP to store in the global store).

It also keeps track of low-level form UX details like:

- Which form fields are dirty
- Which form fields are valid/invalid
- Which form fields are touched (i.e. don't show validation errors for untouched fields)
- Enabling/disabling buttons/form UX based on the overall form-wide state
- Submitting the form should touch (validate) all fields
- Auto-saving the form when appropriate (i.e. not on keystroke, but after blur/leaving the field)
- Queueing auto-saves if one is already in-flight
  - Auto-saves in a table with per-row forms will serialize to avoid cross-child write conflicts on the backend
- Not over-writing the user's WIP/actively-focused field when auto-saved data refreshes
- Building a wire payload that has only changed fields
  - `form.changedValue` will return the entity `id` + only changed fields to faciliate doing partial update APIs
  - Supports collections of children, i.e. a `author: { books: [...} }` will include only changed books if necessary
  - Child collections can be either exhausive (if any child changes, submit them all) or incremental (only include changed children), to match the backend endpoint's semantics

# Main Features

There are two main reasons why form-state exists:

1. Provide a `FieldState` interface for component libraries
2. Match the "three shapes" mental model of our forms

## FieldState Interface & "One-Line" Forms

The core abstraction that `form-state` provides is a `FieldState` interface that looks like:

```ts
// Very simplified example
interface FieldState {
  value: V
  errors: string[]
  valid: boolean
  touched: boolean
}
```

Which combines all the logical aspects of "a single form field" into a single object/prop.

This facilitates the "gold standard" of form libraries, which is "one line per form field", i.e:

```tsx
function AuthorEditorComponent() {
  const author = useFormState(() => /* ... */ );
  return (
    <FormLines>
      <BoundTextField field={author.firstName} />
      <BoundTextField field={author.lastName} />
      <BoundSelectField field={author.city} options={...cities...} />
    </FormLines>
  )
}
```

Besides great developer ergonomics (low boilerplate, very DRY code), this approach also provides a very consistent UI/UX for users, because all forms get the highly-polish behavior of `BoundTextField` for free.

(See the `BoundTextField` in [Beam](https://github.com/homebound-team/beam) for an actual implementation of this approach.)

## The Three Shapes Mental Model

In general when working with any forms (i.e. not just `form-state`), there are three types/shapes of data involved:

1. The input data/shape from the server (i.e. a GraphQL/REST query)
2. The form data/shape that is being reactively bound to form fields (i.e. used as `<TextField value={form.firstName} onChange={(v) => form.firstName = v} />`)
3. The mutation data/shape that will submit the change to the server (i.e. the GraphQL mutation/REST POST)

form-state generally refers to each of these shapes as:

- The input type
  - (Hrm, in retrospect "input" is an unfortunate term b/c that is what GraphQL uses for its mutation types, i.e. `input SaveAuthorInput`...we should consider changing this).
- The form type
- The ...third type...

And then provides an API/DSL for managing the mapping between each of these in a standard/conventional manner.

Admittedly (and hopefully, b/c it makes the code simpler), the differences between each of these types can often be small, i.e.:

- The input type might have `{ author: { book: { id: "b:1" } }` but the mutation wants `{ author: { bookId: "b:1" } }`
- ...have other examples...

These are usually simple/mechanistic changes, but nonetheless just some boilerplate that form-state provides conventions for.

# Basic Usage

See the [sample](https://github.com/homebound-team/form-state/blob/main/src/FormStateApp.tsx).

# Todo

- Add conditional readonly logic, like `{ type: "field", readOnlyIf: i => i.isInternal.value }`

- Add `omitFromValue` so we can have two fields, `book.author.id` / `book.author.name`, where `book.author.name` is used for showing the author name, but `book.author.id` is the only field that is submitted to the server on mutation (maybe pair this with `Ref` based mutations)

- Undo/redo would in theory be neat and easy to do on top of the existing infra

# Features

## Fragments

Normally, form-state expects all fields in the form to be inputs to the GraphQL mutation/wire call. For example, the `author.firstName` field will always be submitted to the `saveAuthor` mutation (albeit with `author.changedValue` you can have `firstName` conditionally included).

However, sometimes there is "other data" that your UX needs to render the form, but is not strictly a form field, but it would be handy for the data to "just be on the form" anyway, as you're passing it in code.

A stereotypical example of this is GraphQL fragments, where an `AuthorFragment` might have a lot of misc read-only info that you want to display next to/within your form, but is not technically editable.

In form-state, you can model with as a `Fragment`, which is setup as:

```ts
// Your input type, likely generated from GraphQL mutation
type AuthorInput = { firstName?: string };
// Your "extra data", likely from your page's GraphQL query to get
// the author to edit + "misc other data"

// For your form, add-in the "extra data"
type AuthorState = AuthorInput & { fragment: Fragment<AuthorFragment > };
}
```



# Internal Implementation Notes

form-state keeps the "actual data" (basically a POJO of your form data) separate from the "mobx proxies that track reactivity" (the `ObjectState` interface with `.get` / `.set` / `.errors` other methods).

This works well b/c the "actual data" returned from `ObjectState.value` or `FieldState.value` is always a non-proxy POJO that can be dropped on the wire without causing serialization issues.

However, it does mean that form-state internally uses a few "that looks odd" tricks like `_tick.value++` to ensure code like `formState.value.firstName` will be reactive, even though the `.firstName` is not actually a proxy access (but doing `formState.firstName.value` would be).

(To be clear, both `formState.firstName.value` and `formState.value.firstName` return the same value, and also have the same reactivity semantics, this is just noting that form-state's internals need to do a few extra tricks to get the latter to be reactive.)
