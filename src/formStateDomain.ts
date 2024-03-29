// Pretend domain objects for editing in the form, i.e. as generated
// by a GraphQL schema for a `saveAuthor` mutation that takes an author
// plus the author's books.

export const jan1 = new Date(2020, 0, 1);
export const jan2 = new Date(2020, 0, 2);
export const dd100: DeweyDecimalClassification = { number: "100", category: "Philosophy" };
export const dd200: DeweyDecimalClassification = { number: "200", category: "Religion" };

export enum Color {
  Red = "RED",
  Blue = "BLUE",
  Green = "GREEN",
}

export interface AuthorInput {
  id?: string | null;
  otherId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  birthday?: Date | null;
  books?: BookInput[] | null;
  address?: AuthorAddress | null;
  favoriteColors?: Color[] | null;
}

export interface AuthorAddress {
  id?: string | null;
  street?: string | null;
  city?: string | null;
}

export interface BookInput {
  id?: string | null | undefined;
  title?: string | null | undefined;
  classification?: DeweyDecimalClassification;
  delete?: boolean | null | undefined;
  isPublished?: boolean;
  op?: "include" | "delete" | "remove";
}

export interface DeweyDecimalClassification {
  number: string;
  category: string;
}

export class DateOnly {
  constructor(private readonly date: Date) {}

  toString() {
    return this.date.toISOString().split("T")[0];
  }

  toJSON() {
    return this.toString();
  }
}
