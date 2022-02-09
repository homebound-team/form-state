import "@testing-library/jest-dom";
import { configure } from "mobx";

// formState doesn't use actions
configure({ enforceActions: "never" });

beforeEach(() => {
  jest.useFakeTimers("modern");
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});
