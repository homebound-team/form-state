import "@testing-library/jest-dom";
import { configure } from "mobx";

// formState doesn't use actions
configure({ enforceActions: "never" });

beforeAll(() => jest.useFakeTimers("modern"));
afterAll(() => jest.useRealTimers());
