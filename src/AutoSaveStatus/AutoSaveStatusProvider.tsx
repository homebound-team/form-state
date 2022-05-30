import React, { PropsWithChildren, useCallback, useEffect, useState } from "react";

export enum AutoSaveStatus {
  IDLE = "idle",
  SAVING = "saving",
  DONE = "done",
  ERROR = "error",
}

export interface AutoSaveStatusContextType {
  status: AutoSaveStatus;
  /** Resets status to IDLE, particularly useful if "Error" or "Done" is stale */
  resetStatus: VoidFunction;
  errors: unknown[];
  /** Notifies AutoSaveContext that a request is in-flight */
  triggerAutoSave: VoidFunction;
  /** Notifies AutoSaveContext that a request has settled, optionally taking an error */
  resolveAutoSave: (error?: unknown) => void;
}

export const AutoSaveStatusContext = React.createContext<AutoSaveStatusContextType>({
  status: AutoSaveStatus.IDLE,
  resetStatus() {},
  errors: [],
  triggerAutoSave() {},
  resolveAutoSave() {},
});

export function AutoSaveStatusProvider({ children }: PropsWithChildren<{}>) {
  const [status, setStatus] = useState(AutoSaveStatus.IDLE);
  const [errors, setErrors] = useState<unknown[]>([]);
  const [inFlight, setInFlight] = useState(0);

  useEffect(() => {
    if (inFlight === 0) {
      if (status === AutoSaveStatus.IDLE) return;
      else if (errors.length) return setStatus(AutoSaveStatus.ERROR);
      else return setStatus(AutoSaveStatus.DONE);
    }
    if (inFlight > 0) return setStatus(AutoSaveStatus.SAVING);
  }, [errors.length, inFlight, status]);

  const triggerAutoSave = useCallback(() => {
    setInFlight((c) => c + 1);
    setErrors([]);
  }, []);

  const resolveAutoSave = useCallback((error?: unknown) => {
    setInFlight((c) => Math.max(0, c - 1));
    if (error) setErrors((errs) => errs.concat(error));
  }, []);

  const resetStatus = useCallback(() => {
    setStatus(AutoSaveStatus.IDLE);
    setErrors([]);
  }, []);

  return (
    <AutoSaveStatusContext.Provider value={{ status, resetStatus, errors, triggerAutoSave, resolveAutoSave }}>
      {children}
    </AutoSaveStatusContext.Provider>
  );
}
