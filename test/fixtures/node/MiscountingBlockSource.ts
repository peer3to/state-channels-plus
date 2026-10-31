// @spec-test-coverage-ignore: backfill block source staging; executable evidence belongs to its calling test declarations
import { ListedBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ListedBlockSource";

/**
 * A backfill block source for a chain that holds one more storage entry per
 * account than the history names: every backfilled account stays lazy.
 */
export class MiscountingBlockSource extends ListedBlockSource {
    // overrides ListedBlockSource.countStorageEntries, which cannot count: reports an entry the history never named
    public override async countStorageEntries(): Promise<number> {
        return Number.MAX_SAFE_INTEGER;
    }
}
