import "@testing-library/jest-dom/vitest";
import { configure } from "mobx";

// formState doesn't use actions
configure({ enforceActions: "never" });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});
