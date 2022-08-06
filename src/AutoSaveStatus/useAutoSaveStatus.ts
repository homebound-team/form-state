import { useCallback, useContext, useEffect, useRef } from "react";
import { AutoSaveStatus, AutoSaveStatusContext } from "./AutoSaveStatusProvider";

export interface AutoSaveStatusHook {
  status: AutoSaveStatus;
  errors: string[];
  /**
   * Sets the current component's loading state.
   *
   * If `error` is passed, it will be added as `errors`; note that we assume `error`
   * will be passed on the loading `true` -> `false` transition.
   */
  setSaving(loading: boolean, error?: string): void;
}

/**
 * Provides the current auto-save `status` as well as a `setSaving` setter
 * to easily flag the current component's loading state as true/false.
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
  const isLoading = useRef(false);

  // Make a setter that can be called on every render but only trigger/resolve if loading changed
  const setSaving = useCallback(
    (loading: boolean, error?: string) => {
      if (loading !== isLoading.current) {
        loading ? triggerAutoSave() : resolveAutoSave(error);
        isLoading.current = loading;
      }
    },
    [triggerAutoSave, resolveAutoSave],
  );

  // Ensure we resolveAutoSave on unmount
  useEffect(() => {
    return () => {
      isLoading.current && resolveAutoSave();
    };
  }, [resolveAutoSave]);

  return { status, errors, setSaving };
}
