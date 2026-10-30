"use client";

import { useCallback, useMemo, useState } from "react";

export interface RowSelection {
  // Rows on the page that may be ticked, and the ticked ones among them.
  selectable: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  // State of the header checkbox: every selectable row, some of them, or none.
  headerState: boolean | "indeterminate";
  toggle: (rowId: string, checked: boolean) => void;
  toggleAll: (checked: boolean) => void;
  clear: () => void;
}

// Which rows of the shown page the user has ticked. Only rows that are on the page and still selectable count, so the
// number on a bulk button always matches what the table shows, and a tick on a row that left the page (another page,
// a new filter, a status that changed) never reaches a request. Ticks come back if the row does.
export function useRowSelection(selectableIds: readonly string[]): RowSelection {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const selectable = useMemo(() => new Set(selectableIds), [selectableIds]);
  const selected = useMemo(() => new Set(selectableIds.filter((id) => chosen.has(id))), [selectableIds, chosen]);
  const headerState =
    selectable.size > 0 && selected.size === selectable.size ? true : selected.size > 0 ? "indeterminate" : false;

  const toggle = useCallback((rowId: string, checked: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);
  const toggleAll = useCallback(
    (checked: boolean) =>
      setChosen((current) => {
        const next = new Set(current);
        for (const id of selectableIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    [selectableIds],
  );
  const clear = useCallback(() => setChosen(new Set()), []);

  return useMemo(
    () => ({ selectable, selected, headerState, toggle, toggleAll, clear }),
    [selectable, selected, headerState, toggle, toggleAll, clear],
  );
}
