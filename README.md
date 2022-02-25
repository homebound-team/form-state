# form-state

form-state is a headless form state management library, built on top of mobx.

It acts as a buffer between the canonical data/entity (i.e. the server-side data, or local Redux/GraphQL/etc. cache data) and the user's WIP data/entity that is being actively mutated in form fields.

It also keeps track of low-level form UX details like:

* Which form fields are dirty
* Which forms fields are valid/invalid
* Which forms fields are touched (i.e. don't show validation errors for untouched fields)
* Enabling/disabling buttons/form UX based on the overall form-wide state
* Submitting the form should touch (validate) all fields
* Auto-saving the form when appropriate (i.e. not on keystroke, but after blur/leaving the field)
* Queue and debounce auto-saves if one is already in-flight
* Building a wire payload that has only changed fields
  * Handles children, i.e. a `author: { books: [...} }` will include only changed books if necessary

# The Three Type/Shapes Mental Model

In general when working with forms (e.g. not just form-state), there are three types/shapes of data involved:

1. The input data/shape from the server (i.e. a GraphQL/REST query)
2. The form data/shape that is being reactively bound to form fields (i.e. used as `<TextField value=form.firstName onChange=(v) => form.firstName = v />`)
3. The mutation data/shape that will submit the change to the server (i.e. the GraphQL mutation/REST POST)

form-state generally refers to each of these shapes as:

* The input type
  * (Hrm, in retrospect "input" is an unfortunate term b/c that is what GraphQL uses for its mutation types, i.e. `input SaveAuthorInput`...we should consider changing this).
* The form type
* The ...third type...

And then provides an API/DSL for managing the mapping between each of these in a standard/conventional manner. 


Admittedly (and hopefully, b/c it makes the code simpler), the differences between each of these types can often be small, i.e.:

* The input type might have `{ author: { book: { id: "b:1" } }` but the mutation wants `{ author: { bookId: "b:1" } }`
* ...have other examples...

These are usually simple/mechanistic changes, but nonetheless just some boilerplate that form-state provides conventions for.

# Basic Usage

See the [sample](https://github.com/homebound-team/form-state/blob/main/src/FormStateApp.tsx).

# Todo

- Add conditional readonly logic, like `{ type: "field", readOnlyIf: i => i.isInternal.value }`

- Add `omitFromValue` so we can have two fields, `book.author.id` / `book.author.name`, where `book.author.name` is used for showing the author name, but `book.author.id` is the only field that is submitted to the server on mutation (maybe pair this with `Ref` based mutations)

- Undo/redo would in theory be neat and easy to do on top of the existing infra
