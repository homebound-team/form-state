import { act, renderHook } from "@testing-library/react-hooks";
import { useContext } from "react";
import { AutoSaveStatus, AutoSaveStatusContext, AutoSaveStatusProvider } from "./AutoSaveStatusProvider";
import { useAutoSaveStatus } from "./useAutoSaveStatus";

const wrapper = AutoSaveStatusProvider;

describe(useAutoSaveStatus, () => {
  /** The internal setTimeout running after tests is spamming the console, so cancel them all here */
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("renders without a provider", () => {
    const { result } = renderHook(() => useAutoSaveStatus());

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("renders with a provider", () => {
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });

    expect(result.current.status).toBe(AutoSaveStatus.IDLE);
  });

  it("indicates when something is in-flight", () => {
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });

    act(() => result.current.setLoading(true));

    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
  });

  it("indicates when a request has settled", () => {
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });

    act(() => result.current.setLoading(true));
    act(() => result.current.setLoading(false));

    expect(result.current.status).toBe(AutoSaveStatus.DONE);
  });

  it("indicates when an error happened", () => {
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });

    act(() => result.current.setLoading(true));
    act(() => result.current.setLoading(false, "Some error"));

    expect(result.current.status).toBe(AutoSaveStatus.ERROR);
    expect(result.current.errors.length).toBe(1);
  });

  it("status goes through the full lifecycle when passed a reset timeout", async () => {
    // Given a timeout has been passed to `useAutoSave()`
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });
    // When we trigger a save
    act(() => result.current.setLoading(true));
    // Then status is Saving
    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
    // And when we trigger a resolution
    act(() => result.current.setLoading(false));
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
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });
    act(() => result.current.setLoading(true));
    act(() => result.current.setLoading(false, "some error"));
    expect(result.current.errors.length).toBe(1);
    act(() => result.current.setLoading(true));
    expect(result.current.errors.length).toBe(0);
    expect(result.current.status).toBe(AutoSaveStatus.SAVING);
  });

  it("does not automatically invoke reset timeout if there are errors", () => {
    // Given a timeout has been passed to `useAutoSave()`
    const { result } = renderHook(() => useAutoSaveStatus(), { wrapper });

    act(() => result.current.setLoading(true));
    act(() => result.current.setLoading(false, "Some error"));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.status).toBe(AutoSaveStatus.ERROR);
    expect(result.current.errors.length).toBe(1);
  });

  it("handles multiple in-flight requests", () => {
    const { result } = renderHook(() => useContext(AutoSaveStatusContext), { wrapper });

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

  it("clears errors when a new save is triggered", () => {
    const { result } = renderHook(() => useContext(AutoSaveStatusContext), { wrapper });

    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave("some error"));
    act(() => result.current.triggerAutoSave());

    expect(result.current.errors.length).toBe(0);
  });

  it("handles calling resolve too much", () => {
    const { result } = renderHook(() => useContext(AutoSaveStatusContext), { wrapper });

    // When save hasn't been invoked yet
    act(() => result.current.resolveAutoSave());

    // Then we effectively didn't run
    expect(result.current.status).toBe(AutoSaveStatus.IDLE);

    // And when 1 save has triggered, and we resolve too much
    act(() => result.current.triggerAutoSave());
    act(() => result.current.resolveAutoSave());
    act(() => result.current.resolveAutoSave());

    // Then we expect it to be happily "Done"
    expect(result.current.status).toBe(AutoSaveStatus.DONE);
  });
});
