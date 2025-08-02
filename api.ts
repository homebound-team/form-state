type SaveAuthor = {
  id?: null | string | undefined;
  first?: null | string | undefined;
  last?: null | string | undefined;
  address?: null | string | undefined;
};

type FormConfig<T> = {
  [P in keyof T]?: "required" | "optional";
};

type Form<T> = T;

function config<T, const U extends FormConfig<T> = FormConfig<T>>(fields: U): Form<Pick<T, keyof U & keyof T>> {
  return null!;
}
// function config<T>() {
//   return <U extends FormConfig<T>>(fields: U): Form<Pick<T, keyof U & keyof T>> => {
//     return null!;
//   };
// }

const editFirstLast = config<SaveAuthor>({
  first: "required",
  last: "required",
  // this should be invalid
  // foo: "optional",
});

// this should be valid
console.log(editFirstLast.first);
console.log(editFirstLast.last);
// I want this to be not valid
console.log(editFirstLast.address);
console.log(editFirstLast.foo);
