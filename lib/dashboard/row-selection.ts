export function toggleRowSelection(selected: string[], id: string, checked: boolean): string[] {
  if (checked) {
    return selected.includes(id) ? selected : [...selected, id];
  }
  return selected.filter((current) => current !== id);
}

export function applyVisibleSelection(
  selected: string[],
  visibleIds: string[],
  checked: boolean
): string[] {
  if (visibleIds.length === 0) return selected;
  if (checked) return Array.from(new Set([...selected, ...visibleIds]));
  const drop = new Set(visibleIds);
  return selected.filter((id) => !drop.has(id));
}

/**
 * Header Select All/Deselect All against the rows currently on screen.
 * Ignore deselect while the list is refetching or showing placeholder data so a
 * Radix controlled-checkbox transition cannot wipe another page's IDs.
 */
export function applyHeaderSelectionChange(
  selected: string[],
  liveVisibleIds: string[],
  checked: boolean,
  fetching = false
): string[] {
  if (!checked && fetching) return selected;
  return applyVisibleSelection(selected, liveVisibleIds, checked);
}

export function visibleHeaderState(
  selected: string[],
  visibleIds: string[]
): boolean | "indeterminate" {
  if (visibleIds.length === 0) return false;
  const selectedSet = new Set(selected);
  let selectedVisible = 0;
  for (const id of visibleIds) {
    if (selectedSet.has(id)) selectedVisible += 1;
  }
  if (selectedVisible === 0) return false;
  if (selectedVisible === visibleIds.length) return true;
  return "indeterminate";
}

export function bulkActionOrderIds(selected: string[]): string[] {
  return [...new Set(selected)];
}
