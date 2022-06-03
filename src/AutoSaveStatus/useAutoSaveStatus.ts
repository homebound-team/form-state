import { useContext } from "react";
import { AutoSaveStatusContext } from "./AutoSaveStatusProvider";

export function useAutoSaveStatus() {
  return useContext(AutoSaveStatusContext);
}
