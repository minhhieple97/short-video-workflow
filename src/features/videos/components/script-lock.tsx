"use client";

import type { ReactNode } from "react";

import { ScriptLockContext } from "./script-lock-context";

// A disabled fieldset natively disables every button, input and textarea inside it, so the editor is read-only while
// the script is being regenerated (the API rejects those edits too). Radix controls also read the flag from context.
export function ScriptLock({ locked, children }: Readonly<{ locked: boolean; children: ReactNode }>) {
  return (
    <ScriptLockContext value={locked}>
      <fieldset disabled={locked} className="min-w-0">
        {children}
      </fieldset>
    </ScriptLockContext>
  );
}
