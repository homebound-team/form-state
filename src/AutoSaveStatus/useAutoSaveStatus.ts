import { useContext, useEffect, useRef } from "react";
import { AutoSaveStatus, AutoSaveStatusContext } from "./AutoSaveStatusProvider";

/**
 * Provides access to the nearest AutoSaveContext data, with an optional
 * parameter to reset from "Done" to "Idle" after a given timeout
 */
export function useAutoSaveStatus(resetToIdleTimeout?: number) {
  const autoSave = useContext(AutoSaveStatusContext);
  const { status, resetStatus } = autoSave;
  const resetToIdleTimeoutRef = useRef<number | null>(null);

  /** Resets AutoSaveStatus from "Done" to "Idle" after a timeout, if one is provided */
  useEffect(() => {
    if (resetToIdleTimeout === undefined) return;

    // Specifically avoid auto-reset if Errors are present
    if (status !== AutoSaveStatus.DONE) return;

    // Only run the latest Timeout
    if (resetToIdleTimeoutRef.current) clearTimeout(resetToIdleTimeoutRef.current);

    resetToIdleTimeoutRef.current = window.setTimeout(() => {
      resetStatus();
      resetToIdleTimeoutRef.current = null;
    }, resetToIdleTimeout);
  }, [resetStatus, resetToIdleTimeout, status]);

  return autoSave;
}
