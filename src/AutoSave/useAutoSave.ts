import { useContext, useEffect, useRef } from "react";
import { AutoSaveContext, AutoSaveStatus } from "./AutoSaveProvider";

export function useAutoSave(resetToIdleTimeout?: number) {
  const autoSave = useContext(AutoSaveContext);
  const { status, resetStatus } = autoSave;
  const resetToIdleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /** Resets AutoSaveStatus from "Done" to "Idle" after a timeout, if one is provided */
  useEffect(() => {
    if (resetToIdleTimeout === undefined) return;
    if (status !== AutoSaveStatus.DONE && resetToIdleTimeoutRef.current) {
      clearTimeout(resetToIdleTimeoutRef.current);
      resetToIdleTimeoutRef.current = null;
    } else {
      resetToIdleTimeoutRef.current = setTimeout(resetStatus, resetToIdleTimeout);
    }
  }, [resetStatus, resetToIdleTimeout, status]);

  return autoSave;
}
