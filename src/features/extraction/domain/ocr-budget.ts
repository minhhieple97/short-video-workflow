// Pacing: one OCR batch may be open per extraction. Opening several at once would multiply spend before any
// result is known and would trip provider quotas.
export const MAX_OPEN_OCR_OPERATIONS = 1;

// Until an operation settles it holds its budget reservation, including while its submit outcome is unknown.
export const OPEN_OCR_OPERATION_STATUSES = ["PLANNED", "SUBMITTING", "SUBMITTED", "UNKNOWN_OUTCOME"] as const;

export type OcrOperationState = (typeof OPEN_OCR_OPERATION_STATUSES)[number] | "COMPLETED" | "FAILED" | "CANCELLED";

export const SETTLED_OCR_OPERATION_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

// Rounds up to a whole micro-USD; toPrecision first removes float noise such as 0.0005 * 1e6 = 500.00000000000006.
export function toMicroUsd(usd: number): number {
  return Math.ceil(Number((usd * 1_000_000).toPrecision(12)));
}

export function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export interface BudgetState {
  ceilingMicroUsd: number;
  reservedMicroUsd: number;
  spentMicroUsd: number;
}

export function remainingBudget({ ceilingMicroUsd, reservedMicroUsd, spentMicroUsd }: BudgetState): number {
  return Math.max(0, ceilingMicroUsd - reservedMicroUsd - spentMicroUsd);
}

export function fitsBudget(state: BudgetState, requestedMicroUsd: number): boolean {
  return requestedMicroUsd <= remainingBudget(state);
}
