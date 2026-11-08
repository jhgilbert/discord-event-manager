/**
 * Midnight at the start of `date`'s day, in unix seconds. The zone is `TZ`,
 * because `setHours` reads the process clock — the same zone chrono reads a
 * host's "Friday 7pm" in.
 */
export function startOfDay(date: Date): number {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}
