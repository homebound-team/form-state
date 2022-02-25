# form-state

form-state is a headless form state management library, built on top of mobx.

It acts as a buffer between the current canonical data (i.e. the server-side data, or GraphQL cache data) and the user's WIP data that is being actively mutated in form fields.

It also keeps track of low-level form UX details like:

* Which form fields are dirty
* Which forms fields are invalid/invalid
* Which forms fields are touched (i.e. don't show validation errors for untouched fields)
* Attempting to submit the form should touch (valid) all fields
* When should form fields auto-save?
* Which form fields should auto-save?
* Building a wire payload that has only changed fields

# The Three Type/Shapes Mental Model

There are generally three types of data involved in a form:

1. The input data/shape from the server (i.e. a GraphQL/REST query)
2. The form data/shape that is being reactively bound to form fields
3. The mutation data/shape that will submit the change to the server (i.e. the GraphQL mutation)

form-state generally refers to each of these shapes as:

* The input type
* The form type
* The ...third type...

(Note that "input type" is an unfortunate name b/c that is what GraphQL uses for it's mutation types, i.e. `input SaveAuthorInput`...we should consider changing this).

Concretely the differences between these small types are small nuances:

* The input type might have `{ author: { book: { id: "b:1" } }` but the mutation wants `{ author: { bookId: "b:1" } }`
* ...have other examples...

That are usually simple/mechanistic changes, but nonetheless just some boilerplate that form-state helps pages have a strong convention around.

# Basic Usage

See the [sample](https://github.com/homebound-team/form-state/blob/main/src/FormStateApp.tsx).

# Todo

- Add conditional readonly logic, like `{ type: "field", readOnlyIf: i => i.isInternal.value }`

- Add `omitFromValue` so we can have two fields, `book.author.id` / `book.author.name`, where `book.author.name` is used for showing the author name, but `book.author.id` is the only field that is submitted to the server on mutation (maybe pair this with `Ref` based mutations)

- Undo/redo would in theory be neat and easy to do on top of the existing infra
