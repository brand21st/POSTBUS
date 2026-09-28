/** Orders to add when a chip is clicked. Already-selected IDs return an empty list. */
export function nextGroupFromList(list: string[], startId: string, alreadySelected: string[]): string[] {
  const key = startId.trim();
  if (!key) return [];
  if (alreadySelected.includes(key)) return [];

  const added = [key];
  if ((alreadySelected.length + 1) % 4 !== 1) return added;

  const start = list.indexOf(key);
  if (start < 0) return added;

  const taken = new Set(alreadySelected);
  taken.add(key);
  for (let index = start + 1; index < list.length && added.length < 4; index += 1) {
    const next = list[index];
    if (!next || taken.has(next)) continue;
    taken.add(next);
    added.push(next);
  }
  return added;
}

export function sheetGroups(orderIds: string[], perSheet: number): string[][] {
  const size = Math.max(1, Math.floor(perSheet) || 1);
  const groups: string[][] = [];
  for (let index = 0; index < orderIds.length; index += size) {
    groups.push(orderIds.slice(index, index + size));
  }
  return groups;
}
