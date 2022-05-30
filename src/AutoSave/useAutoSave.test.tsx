import { act, renderHook } from "@testing-library/react-hooks";
import { AutoSaveProvider, AutoSaveStatus } from "./AutoSaveProvider";
import { useAutoSave } from "./useAutoSave";

describe(useAutoSave, () => {
  it("renders without a provider", () => {
    const { result } = renderHook(() => useAutoSave());

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("renders with a provider", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("indicates when something is in-flight", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    act(() => result.current.triggerAutoSave());

    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
  });

  it("indicates when a request has settled", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave());

    expect(result.current.status).toBe(AutoSaveStatus.DONE);
  });

  it("indicates when an error happened", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave(new Error("Some error")));

    expect(result.current.status).toBe(AutoSaveStatus.ERROR);
    expect(result.current.errors.length).toBe(1);
  });

  it("resets status to Idle when told to", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
    act(() => result.current.triggerAutoSave());
    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
    act(() => result.current.resolveAutoSave());
    expect(result.current.status).toBe(AutoSaveStatus.DONE);
    act(() => result.current.resetStatus());
    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("status goes through the full lifecycle when passed a reset timeout", async () => {
    // Given a timeout has been passed to `useAutoSave()`
    const { result } = renderHook(() => useAutoSave(100), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });
    // When we trigger a save
    act(() => result.current.triggerAutoSave());
    // Then status is Saving
    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
    // And when we trigger a resolution
    act(() => result.current.resolveAutoSave());
    // Then status is Done
    expect(result.current.status).toBe(AutoSaveStatus.DONE);
    // But when the timer runs out
    act(() => {
      jest.runOnlyPendingTimers();
    });
    // Then the status is reset to Idle
    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("clears errors on reset status", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });
    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave(new Error("some error")));
    expect(result.current.errors.length).toBe(1);
    act(() => result.current.resetStatus());
    expect(result.current.errors.length).toBe(0);
    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("does not automatically invoke reset timeout if there are errors", () => {
    // Given a timeout has been passed to `useAutoSave()`
    const { result } = renderHook(() => useAutoSave(100), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave(new Error("Some error")));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.status).toBe(AutoSaveStatus.ERROR);
    expect(result.current.errors.length).toBe(1);
  });

  it("does allow manual resetting even if there are errors", () => {
    // Given a timeout has been passed to `useAutoSave()`
    const { result } = renderHook(() => useAutoSave(100), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave(new Error("Some error")));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    act(() => result.current.resetStatus());

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
    expect(result.current.errors.length).toBe(0);
  });

  it("handles multiple in-flight requests", () => {
    const { result } = renderHook(() => useAutoSave(), {
      wrapper: ({ children }) => <AutoSaveProvider>{children}</AutoSaveProvider>,
    });

    // When we trigger 2 AutoSaves and only resolve 1
    act(() => result.current.triggerAutoSave());
    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave());

    // We expect something to still be in-flight
    expect(result.current.status).toBe(AutoSaveStatus.SAVING);

    // And when we resolve the final one
    act(() => result.current.resolveAutoSave());

    // We expect it to finally settle
    expect(result.current.status).toBe(AutoSaveStatus.DONE);
  });
});
