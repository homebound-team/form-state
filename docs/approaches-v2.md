
I want to glue together:

1. Tiny data/inputs that changes quickly & auto-saves to the backend
2. Large data/fragments that changes infrequently but is referenced in the UI

Options

1. A `form-state` that has both
   * Pro: We have auto-save config rules
   * Pro: We want "this form has a `author: { id, fragment }` or `books: { id, fragment }[]` to be super-easy
   * Con: Hard to add custom derived values
   * Con: `fragment` support in form-state is "just okay"
2. A mobx class with a `toInput` method
   * `makeAutoObservable` to mark the fragments as refs
   * Pro: Pretty simple/should just work
   * Con: We don't get form binding, validation rules, etc
3. A context with all the fields included
4. A context with a POJO of form data + fragments

---

## Scenarios

1. 1:1 mapping of primitives, `AuthorInput.firstName`
2. Primitives with mapped values, `AuthorInput.birthday` is `LocalDate` but render/input as string
3. Parent id/reference, with no extra data, i.e. `BookInput.authorId`
4. Parent id/reference, with contextual data, i.e. `BookInput.author` -> `{ id: string, data: fragment }`
5. Child ids, with no extra data, `Author.bookIds`
6. Child ids, with extra data, i.e. `Author.books` -> `{ id: string, data: fragment }` save as `ID[]`
7. Child ids with incremental updates, just ids
8. Child ids with incremental updates, with extra data
9. Derived fields, i.e. `Author.fullName` or `Author.numberOfBooks`
10. Synchronous validation rules on any of ^
11. Async validation rules on any of ^


---

```ts
class AuthorForm {
  get firstName_errors(): string[] {
    return ["error 1", this.lastName];
  }
}
```
