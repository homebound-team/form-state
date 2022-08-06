import { useCallback, useContext, useEffect, useRef } from "react";
import { AutoSaveStatus, AutoSaveStatusContext } from "./AutoSaveStatusProvider";

export interface AutoSaveStatusHook {
  status: AutoSaveStatus;
  errors: string[];
  /**
   * Sets the current component's saving state.
   *
   * If `error` is passed, it will be added as `errors`; note that we assume `error`
   * will be passed on the saving `true` -> `false` transition.
   */
  setSaving(saving: boolean, error?: string): void;
}

/**
 * Provides the current auto-save `status` as well as a `setSaving` setter
 * to easily flag the current component's saving state as true/false.
 *
 * If your component makes multiple API calls, you can also use two `useAutoSaveStatus`
 * hooks, i.e.:
 *
 * ```
 * const { setSaving: setLoadingA } = useAutoSaveStatus();
 * const { setSaving: setLoadingB } = useAutoSaveStatus();
 * ```
 *
 * Also ideally your application's infra will automatically integrate `useAutoSaveStatus`
 * into all/most wire calls, i.e. by having your own `useMutation` wrapper.
 */
export function useAutoSaveStatus(): AutoSaveStatusHook {
  const { status, errors, triggerAutoSave, resolveAutoSave } = useContext(AutoSaveStatusContext);

  // Keep a ref to our current value so that we can resolveAutoSave on unmount
  const isSaving = useRef(false);

  // Make a setter that can be called on every render but only trigger/resolve if saving changed
  const setSaving = useCallback(
    (saving: boolean, error?: string) => {
      if (saving !== isSaving.current) {
        saving ? triggerAutoSave() : resolveAutoSave(error);
        isSaving.current = saving;
      }
    },
    [triggerAutoSave, resolveAutoSave],
  );

  // Ensure we resolveAutoSave on unmount
  useEffect(() => {
    return () => {
      isSaving.current && resolveAutoSave();
    };
  }, [resolveAutoSave]);

  return { status, errors, setSaving };
}
