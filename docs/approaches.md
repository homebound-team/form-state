form-state supports three (techncially two, one to-come-someday) approaches.

All of them solve "bind this form to these UI elements", with variations on what "this form" means. Specifically all of these approaches support binding to something like Beam's `BoundTextField`.

## Approach 1. Just DTOs and a Form Config

In this approach, the data in the form is "just a DTO", i.e. probably the input to a GraphQL mutation, and has minimal business logic, probably just a few `required` rules and no cross-field derived values.

In this approach, you can use `useFormState` with a config defined against your GraphQL mutation, i.e.:

```typescript
type SaveAuthorInput = {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  email?: string | null | undefined;
};

const config: ObjectConfig<SaveAuthorInput> = {
  firstName: { type: "value", rules: [required] },
  lastName: { type: "value", rules: [required] },
  email: { type: "value", rules: [required, validEmail] },
};
```

- Pro: Generally the least amount of boilerpate, because you use the `SaveAuthorInput` type from the GraphQL codegen output
- Con: Any derived values (i.e. `fullName`) would need to be in manually-created `Observer` blocks within the view code

## Approach 2. Mobx with a Form Config

If you want to start having derived values, switching to a small mobx class, but still using the config DSL is a good approach:

```typescript
class AuthorForm {
  firstName: Maybe<string>;
  lastName: Maybe<string>;
  email: Maybe<string>;

  constructor() {
    makeAutoObservable(this);
  }

  get fullName() {
    return this.firstName + this.lastName;
  }
}

const config: ObjectConfig<SaveAuthorInput> = {
  firstName: { type: "value", rules: [required] },
  lastName: { type: "value", rules: [required] },
  email: { type: "value", rules: [required, validEmail] },
};
```

- Pro: Easy to add potentially-complicated derived values
- Pro: Mobx is generally pleasant to use
- Con: The "valid" state of each field is not accessible from the class, so you can't have derived value (i.e. `AuthorForm.enableNext`)

## Approach 3. Mobx with no Form Config

This approach is still TBD but goes all in on mobx but moving the field config directly into the form class itself. It might look something like:

```typescript
class AuthorForm extends Form {
  firstName = this.newField({ name: 'firstName', rules: [required] });
  lastName = this.newField({ name: 'lastName', rules: [required] });
  fullName = this.newDerivedField({
    name: 'fullName',
    get: (f) => f.firstName.value + f.lastName.value
  })

  constructor(...)

  get enableNext()  {
    return this.firstName.valid && this.lastName.valid && this.fullName.valid;
  }
}
```

- Pro: The class has full access to the each `FieldState` to drive business logic
- Pro: The `firstName`/etc fields can still be passed to `<BoundTextField field={form.firstname} />`

...or maybe...

```typescript
class AuthorForm extends Form<SaveAuthorInput> {
  constructor(config: ObjectConfig<SaveAuthorInput>) {
    super(config);
  }

  get fullName() {
    return this.fields.firstName + this.fields.lastName;
  }

  get enableNext() {
    return this.fields.firstName.valid;
  }
}
```
