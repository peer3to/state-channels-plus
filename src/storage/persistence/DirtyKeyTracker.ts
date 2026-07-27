/**
 * Revisioned dirty-key tracker shared by every store that opts into
 * PersistenceEngine's bounded diff (PO1). A plain dirty Set is not
 * retry-safe under a successful-but-racing commit (RR1): the engine peeks
 * keys, reads their current values, awaits `port.commit()`, and only then
 * clears the peeked keys. A mutation landing on the same key during that
 * await would re-add to a plain Set as a no-op, and the post-commit clear
 * would then wipe it out even though its new value was never diffed.
 *
 * Tagging every mark with a monotonically increasing revision fixes this:
 * `clear()` only removes a key if its revision still matches what was
 * peeked, so a key mutated again mid-flush survives to the next flush.
 */
export class DirtyKeyTracker<K> {
    private readonly revisions = new Map<K, number>();
    private nextRevision = 1;

    markDirty(key: K): void {
        this.revisions.set(key, this.nextRevision++);
    }

    /** Snapshot of (key, revision) pairs dirtied since the last successful clear. */
    peek(): Iterable<readonly [K, number]> {
        return this.revisions.entries();
    }

    /** Clears exactly the entries whose revision hasn't advanced since they were peeked. */
    clear(entries: Iterable<readonly [K, number]>): void {
        for (const [key, revision] of entries) {
            if (this.revisions.get(key) === revision) {
                this.revisions.delete(key);
            }
        }
    }
}
