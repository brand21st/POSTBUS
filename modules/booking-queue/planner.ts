/**
 * When automatic booking starts a batch, and which items go in it. Pure: no clock, no database.
 *
 * Timer semantics: the waiting clock is the oldest ready item's ready_at. It never resets when new
 * orders arrive. Full batches of `threshold` take the oldest items first; what is left waits until
 * its own oldest item has waited `maxWaitMinutes`, then goes as one smaller batch.
 *
 * The threshold is a logical batch size. It does not change how many articles go in one India Post
 * request; until bulk sending is verified every article is still sent on its own.
 */

/** Never put more items than this into automatic runs in one scheduler tick. */
export const MAX_ITEMS_PER_TICK = 5000;
/** Never start more runs than this in one tick, however small the threshold. */
export const MAX_RUNS_PER_TICK = 10;

export type ReadyItem = { id: string; readyAt: string };
export type PlannedRun = { trigger: "AUTO_THRESHOLD" | "AUTO_TIMEOUT"; itemIds: string[] };

function waitedLongEnough(readyAt: string, maxWaitMinutes: number | null, now: Date) {
  if (maxWaitMinutes == null) return false;
  const started = Date.parse(readyAt);
  return Number.isFinite(started) && started + maxWaitMinutes * 60_000 <= now.getTime();
}

/** How many runs and items one tick may take for this threshold. */
export function tickLimits(threshold: number) {
  const size = Math.max(1, Math.floor(threshold));
  const runs = Math.min(MAX_RUNS_PER_TICK, Math.max(1, Math.floor(MAX_ITEMS_PER_TICK / size)));
  return { runs, items: runs * size };
}

/** Cheap check for the scheduler scan: is anything due for this workspace now? */
export function automaticRunDue(input: {
  readyCount: number;
  oldestReadyAt: string | null;
  threshold: number;
  maxWaitMinutes: number | null;
  now: Date;
}) {
  if (input.readyCount <= 0) return false;
  if (input.readyCount >= input.threshold) return true;
  return input.oldestReadyAt ? waitedLongEnough(input.oldestReadyAt, input.maxWaitMinutes, input.now) : false;
}

/** When the waiting clock runs out for the current ready items, from persisted timestamps. */
export function nextAutomaticTimeout(oldestReadyAt: string | null, maxWaitMinutes: number | null) {
  if (!oldestReadyAt || maxWaitMinutes == null) return null;
  const started = Date.parse(oldestReadyAt);
  return Number.isFinite(started) ? new Date(started + maxWaitMinutes * 60_000).toISOString() : null;
}

/**
 * Runs to start now. `items` must be READY_FOR_BOOKING, oldest first, and at most
 * tickLimits(threshold).items long (so a remainder means every ready item was loaded).
 */
export function planAutomaticRuns(
  items: ReadyItem[],
  options: { threshold: number; maxWaitMinutes: number | null; now: Date }
): PlannedRun[] {
  const threshold = Math.max(1, Math.floor(options.threshold));
  const { runs: maxRuns } = tickLimits(threshold);
  const ordered = [...items].sort((a, b) => a.readyAt.localeCompare(b.readyAt) || a.id.localeCompare(b.id));
  const planned: PlannedRun[] = [];
  let index = 0;
  while (ordered.length - index >= threshold && planned.length < maxRuns) {
    planned.push({ trigger: "AUTO_THRESHOLD", itemIds: ordered.slice(index, index + threshold).map((item) => item.id) });
    index += threshold;
  }
  const remaining = ordered.slice(index);
  if (
    remaining.length &&
    remaining.length < threshold &&
    planned.length < maxRuns &&
    waitedLongEnough(remaining[0].readyAt, options.maxWaitMinutes, options.now)
  ) {
    planned.push({ trigger: "AUTO_TIMEOUT", itemIds: remaining.map((item) => item.id) });
  }
  return planned;
}
