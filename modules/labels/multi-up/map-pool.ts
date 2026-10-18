/** Run async work with a fixed concurrency cap. Order of results matches input order. */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (!items.length) return results;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
