import { createContext, useContext } from "react";

export const ScriptLockContext = createContext(false);

// Radix controls (Select…) open on pointer events that a disabled fieldset does not block, so they read the lock here.
export function useScriptLocked(): boolean {
  return useContext(ScriptLockContext);
}
