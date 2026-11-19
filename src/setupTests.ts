import "@testing-library/jest-dom/vitest";
import { configure } from "mobx";

// form-state itself only writes observables inside actions (its methods and setters), but our
// tests write directly to the mobx stores they wrap, i.e. `store.firstName = "..."`.
configure({ enforceActions: "never" });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});
