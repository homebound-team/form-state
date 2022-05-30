import React, { PropsWithChildren, useCallback, useEffect, useState } from "react";

export enum AutoSaveStatus {
  IDLE = "idle",
  SAVING = "saving",
  DONE = "done",
  ERROR = "error",
}

export interface AutoSaveContextType {
  status: AutoSaveStatus;
  /** Resets status to IDLE, particularly useful if "Error" or "Done" is stale */
  resetStatus: VoidFunction;
  errors: unknown[];
  /** Notifies AutoSaveContext that a request is in-flight */
  triggerAutoSave: VoidFunction;
  /** Notifies AutoSaveContext that a request has settled, optionally taking an error */
  resolveAutoSave: (error?: unknown) => void;
}

export const AutoSaveContext = React.createContext<AutoSaveContextType>({
  status: AutoSaveStatus.IDLE,
  resetStatus() {},
  errors: [],
  triggerAutoSave() {},
  resolveAutoSave() {},
});

export function AutoSaveProvider({ children }: PropsWithChildren<{}>) {
  const [status, setStatus] = useState(AutoSaveStatus.IDLE);
  const [errors, setErrors] = useState<unknown[]>([]);
  const [inFlight, setInFlight] = useState(0);

  useEffect(() => {
    if (inFlight === 0) {
      if (errors.length) return setStatus(AutoSaveStatus.ERROR);
      else return setStatus(AutoSaveStatus.DONE);
    }
    if (inFlight > 0) return setStatus(AutoSaveStatus.SAVING);
  }, [errors.length, inFlight]);

  const triggerAutoSave = useCallback(() => {
    setInFlight((c) => c + 1);
    setErrors([]);
  }, []);

  const resolveAutoSave = useCallback((error?: unknown) => {
    setInFlight((c) => Math.max(0, c - 1));
    setErrors((errs) => errs.concat(error));
  }, []);

  const resetStatus = useCallback(() => {
    setStatus(AutoSaveStatus.IDLE);
  }, []);

  return (
    <AutoSaveContext.Provider value={{ status, resetStatus, errors, triggerAutoSave, resolveAutoSave }}>
      {children}
    </AutoSaveContext.Provider>
  );
}
