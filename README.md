# form-state

Push release.

# Todo

* Add conditional readonly logic, like `{ type: "field", readOnlyIf: i => i.isInternal.value }`

* Add `omitFromValue` so we can have two fields, `book.author.id` / `book.author.name`, where `book.author.name` is used for showing the author name, but `book.author.id` is the only field that is submitted to the server on mutation (maybe pair this with `Ref` based mutations) 
