import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";

export enum AutoSaveStatus {
  /** No calls are in-flight or just-recently-saved. */
  IDLE = "idle",
  /** A call is actively in-flight. */
  SAVING = "saving",
  /** A call is no longer actively in-flight, but has recently finished/can show confirmed. */
  DONE = "done",
  /** A call is no longer actively in-fight, but has errored out. */
  ERROR = "error",
}

export interface AutoSaveStatusContextType {
  status: AutoSaveStatus;
  errors: string[];
  /** Notifies AutoSaveContext that a request is in-flight */
  triggerAutoSave: VoidFunction;
  /** Notifies AutoSaveContext that a request has settled, optionally taking an error */
  resolveAutoSave: (error?: string) => void;
}

export const AutoSaveStatusContext = React.createContext<AutoSaveStatusContextType>({
  status: AutoSaveStatus.IDLE,
  errors: [],
  triggerAutoSave() {},
  resolveAutoSave() {},
});

type AutoSaveStatusProviderProps = PropsWithChildren<{
  /** After a successful save, reset Status back to `Idle` after this many milliseconds */
  resetToIdleTimeout?: number;
}>;

/**
 * Provides an app-wide-ish store of in-flight/save status.
 *
 * Generally there will be only a single `AutoSaveStatusProvider` at the top of the app's
 * component tree, although you could also have one inside a modal or drawer component
 * to more locally capture/display loading/save status.
 */
export function AutoSaveStatusProvider({ children, resetToIdleTimeout = 6_000 }: AutoSaveStatusProviderProps) {
  const [status, setStatus] = useState(AutoSaveStatus.IDLE);
  const [errors, setErrors] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState(0);
  const resetToIdleTimeoutRef = useRef<number | null>(null);

  // We always derive Status from inFlight/errors
  useEffect(() => {
    if (inFlight > 0) return setStatus(AutoSaveStatus.SAVING);
    if (status === AutoSaveStatus.IDLE) return;
    if (errors.length) return setStatus(AutoSaveStatus.ERROR);
    return setStatus(AutoSaveStatus.DONE);
  }, [errors.length, inFlight, status]);

  const triggerAutoSave = useCallback(() => {
    setInFlight((c) => c + 1);
    setErrors([]);
  }, []);

  const resolveAutoSave = useCallback((error?: string) => {
    setInFlight((c) => Math.max(0, c - 1));
    if (error) setErrors((errs) => errs.concat(error));
  }, []);

  /** Resets AutoSaveStatus from "Done" to "Idle" after a timeout, if one is provided */
  useEffect(() => {
    if (resetToIdleTimeout === undefined) return;

    // Specifically avoid auto-reset if Errors are present
    if (status !== AutoSaveStatus.DONE) return;

    // Only run the latest Timeout
    if (resetToIdleTimeoutRef.current) clearTimeout(resetToIdleTimeoutRef.current);

    resetToIdleTimeoutRef.current = window.setTimeout(() => {
      setStatus(AutoSaveStatus.IDLE);
      setErrors([]);
      resetToIdleTimeoutRef.current = null;
    }, resetToIdleTimeout);
  }, [resetToIdleTimeout, status]);

  const value = useMemo(() => ({ status, errors, triggerAutoSave, resolveAutoSave }), [
    errors,
    resolveAutoSave,
    status,
    triggerAutoSave,
  ]);

  return <AutoSaveStatusContext.Provider value={value}>{children}</AutoSaveStatusContext.Provider>;
}
