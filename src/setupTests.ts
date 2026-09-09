import "@testing-library/jest-dom";
import { configure } from "mobx";

// rtl-utils looks for the test runner on globalThis, and jest only injects `jest` into module scope
(globalThis as any).jest = jest;

// formState doesn't use actions
configure({ enforceActions: "never" });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});
