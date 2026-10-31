/**
 * Runs an async task for each item strictly one after another (each waits for the previous to finish).
 * Use when order matters or the downstream API is rate limited; otherwise prefer Promise.all.
 */
export function forEachSequentially<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  return items.reduce((chain, item) => chain.then(() => task(item)), Promise.resolve())
}
