import { Filter, hexlify } from "ethers";

import { config } from "@/utils/config";
import type { Logger } from "@/utils";
import type { ChannelId } from "@/types/types";

// Lowercase, zero-padded-32-byte channelId topic used as a Set/Map key.
type ChannelKey = string;

/**
 * The slice of a log this module reads. Deliberately narrower than ethers'
 * `Log` class (whose instances still satisfy this structurally) so a test can
 * hand in plain canned objects instead of constructing real `Log`s.
 */
export type ChannelScanLog = {
    readonly address: string;
    readonly topics: readonly string[];
    readonly blockNumber: number;
    readonly index: number;
    readonly transactionHash: string;
};

/**
 * The slice of a `Provider` this module needs. Narrow on purpose - see
 * `ChannelScanLog`; a real ethers `Provider` satisfies this structurally.
 */
export type ChannelIndexProvider = {
    getBlockNumber(): Promise<number>;
    getLogs(filter: Filter): Promise<readonly ChannelScanLog[]>;
};

/**
 * The slice of `StateChannelManagerProxy` this module needs: the
 * `ChannelOpened`/`ChannelStorageCleared` event fragments (for their topic
 * hashes) and the authoritative `isChannelOpen` view. A real
 * `StateChannelManagerProxy` satisfies this structurally.
 */
export type ChannelIndexContract = {
    readonly target: string | { getAddress(): Promise<string> };
    readonly interface: {
        getEvent(
            name: "ChannelOpened" | "ChannelStorageCleared"
        ): { topicHash: string } | null;
    };
    isChannelOpen(
        channelId: ChannelId
    ): Promise<readonly [boolean, ...unknown[]]>;
};

export type ChannelIndexDeps = {
    provider: ChannelIndexProvider;
    stateChannelManagerContract: ChannelIndexContract;
    logger: Logger;
};

export type EnumerateOptions = {
    /** Max number of confirmed-open channelIds to return. Defaults to config. */
    max?: number;
    /** How far back from the head the scan is allowed to walk. Defaults to config. */
    maxLookbackBlocks?: number;
    /** Starting block-range size per `getLogs` call. Defaults to config. */
    chunkBlocks?: number;
};

// Never let a shrunk chunk collapse below this - keeps the retry loop finite.
const MIN_CHUNK_BLOCKS = 1;
// Bounds total shrink-and-retry attempts across the whole scan, so a
// persistently misbehaving provider fails the scan instead of hanging it.
const MAX_CHUNK_SHRINK_RETRIES = 10;
// Bounds the incrementally-ingested (not-yet-scan-confirmed) candidate list.
const MAX_TRACKED_FRESH_CANDIDATES = 256;

function extractErrorMessage(error: unknown): string {
    if (!error || typeof error !== "object") return String(error);
    const withInfo = error as {
        shortMessage?: unknown;
        message?: unknown;
        info?: { error?: { message?: unknown } };
    };
    return String(
        withInfo.shortMessage ??
            withInfo.info?.error?.message ??
            withInfo.message ??
            error
    );
}

/**
 * Heuristic for "the provider rejected this because the range/result set was
 * too large" (provider-specific wording and RPC error codes vary), as opposed
 * to some other, non-recoverable failure.
 */
function looksLikeRangeLimitError(error: unknown): boolean {
    const message = extractErrorMessage(error).toLowerCase();
    return (
        message.includes("query returned more than") ||
        message.includes("too many results") ||
        message.includes("limit exceeded") ||
        message.includes("block range") ||
        message.includes("range is too") ||
        message.includes("too large") ||
        message.includes("-32005")
    );
}

/**
 * On-chain enumeration of joinable ("open") channels. `StateChannelManagerProxy`
 * has no channel-enumerating getter, so this walks `ChannelOpened`/
 * `ChannelStorageCleared` logs backward from the head in bounded chunks to
 * build a candidate set, then confirms each candidate against the
 * authoritative `isChannelOpen` view before returning it.
 */
export class ChannelIndex {
    private readonly provider: ChannelIndexProvider;
    private readonly contract: ChannelIndexContract;
    private readonly logger: Logger;
    private readonly contractAddress: string;
    private readonly channelOpenedTopic: string;
    private readonly channelStorageClearedTopic: string;
    // Candidates learned via ingestLog since construction, newest-first -
    // folded into the next listOpenChannels() scan so a caller feeding fresh
    // events doesn't have to re-scan to see them.
    private freshCandidates: ChannelId[] = [];
    // channelIds seen as ChannelStorageCleared via ingestLog - excluded from
    // every future scan until a newer ChannelOpened for the same id arrives.
    private readonly knownDeadKeys = new Set<ChannelKey>();

    constructor(deps: ChannelIndexDeps) {
        this.provider = deps.provider;
        this.contract = deps.stateChannelManagerContract;
        this.logger = deps.logger.child({ component: "ChannelIndex" });
        this.contractAddress = String(this.contract.target);

        const channelOpened = this.contract.interface.getEvent("ChannelOpened");
        const channelStorageCleared = this.contract.interface.getEvent(
            "ChannelStorageCleared"
        );
        if (!channelOpened || !channelStorageCleared) {
            throw new Error(
                "ChannelIndex: contract ABI is missing ChannelOpened/ChannelStorageCleared"
            );
        }
        this.channelOpenedTopic = channelOpened.topicHash;
        this.channelStorageClearedTopic = channelStorageCleared.topicHash;
    }

    /**
     * Newest-first list of currently open (isChannelOpen-confirmed) channelIds.
     * Walks blocks backward from the head, stopping at `max` candidates or
     * the lookback floor, whichever comes first - never scans from block 0.
     */
    async listOpenChannels(opts: EnumerateOptions = {}): Promise<ChannelId[]> {
        const max = opts.max ?? config.DISCOVERY_SCAN_MAX_CANDIDATES;
        const maxLookbackBlocks =
            opts.maxLookbackBlocks ?? config.DISCOVERY_SCAN_MAX_LOOKBACK_BLOCKS;
        const initialChunkBlocks =
            opts.chunkBlocks ?? config.DISCOVERY_SCAN_CHUNK_BLOCKS;

        if (max <= 0) return [];

        const latestBlock = await this.provider.getBlockNumber();
        const lookbackFloor = Math.max(0, latestBlock - maxLookbackBlocks);

        const candidateIds: ChannelId[] = [];
        // Decided (candidate-or-dead) channel keys, newest-event-wins: once a
        // key is decided we never let an older event for the same id
        // override it.
        const seenKeys = new Set<ChannelKey>();

        for (const channelId of this.freshCandidates) {
            if (candidateIds.length >= max) break;
            const key = this.channelKey(channelId);
            if (seenKeys.has(key) || this.knownDeadKeys.has(key)) continue;
            seenKeys.add(key);
            candidateIds.push(channelId);
        }
        for (const key of this.knownDeadKeys) seenKeys.add(key);

        let chunkBlocks = Math.max(MIN_CHUNK_BLOCKS, initialChunkBlocks);
        let cursor = latestBlock;
        let shrinkRetriesLeft = MAX_CHUNK_SHRINK_RETRIES;

        while (candidateIds.length < max && cursor >= lookbackFloor) {
            const toBlock = cursor;
            const fromBlock = Math.max(
                lookbackFloor,
                toBlock - chunkBlocks + 1
            );

            let logs: readonly ChannelScanLog[];
            try {
                logs = await this.provider.getLogs(
                    this.getDiscoveryFilter(fromBlock, toBlock)
                );
            } catch (error) {
                if (
                    shrinkRetriesLeft > 0 &&
                    chunkBlocks > MIN_CHUNK_BLOCKS &&
                    looksLikeRangeLimitError(error)
                ) {
                    chunkBlocks = Math.max(
                        MIN_CHUNK_BLOCKS,
                        Math.floor(chunkBlocks / 2)
                    );
                    shrinkRetriesLeft -= 1;
                    this.logger.warn(
                        "ChannelIndex scan: range rejected, shrinking chunk and retrying",
                        {
                            fromBlock,
                            toBlock,
                            chunkBlocks,
                            error: String(error)
                        }
                    );
                    continue;
                }
                throw error;
            }

            // Newest-first within the chunk.
            const ordered = [...logs].sort(
                (a, b) => b.blockNumber - a.blockNumber || b.index - a.index
            );
            for (const log of ordered) {
                const channelIdTopic = log.topics[1];
                if (!channelIdTopic) continue;
                const key = channelIdTopic.toLowerCase();
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);

                if (log.topics[0] === this.channelStorageClearedTopic) {
                    continue;
                }
                if (log.topics[0] === this.channelOpenedTopic) {
                    candidateIds.push(channelIdTopic);
                    if (candidateIds.length >= max) break;
                }
            }

            cursor = fromBlock - 1;
        }

        return this.confirmOpen(candidateIds);
    }

    /**
     * Feeds a single unfiltered `ChannelOpened`/`ChannelStorageCleared` log
     * (e.g. from a caller's own live subscription) into the incremental
     * candidate cache, so `listOpenChannels` sees it without re-scanning.
     *
     * Not wired to a live subscription here: `EventSyncService`'s
     * subscription plumbing is scoped end-to-end to a single already-known
     * channelId (constructor, `scheduleLog`, `dispatchLog` all key off it),
     * so broadening it to an unfiltered discovery feed is out of scope for
     * this change. `getDiscoverySubscriptionFilter()` returns the matching
     * filter for a caller to subscribe with directly.
     */
    ingestLog(log: ChannelScanLog): void {
        const channelIdTopic = log.topics[1];
        if (!channelIdTopic) return;
        const key = channelIdTopic.toLowerCase();

        if (log.topics[0] === this.channelStorageClearedTopic) {
            this.knownDeadKeys.add(key);
            this.freshCandidates = this.freshCandidates.filter(
                (id) => this.channelKey(id) !== key
            );
            return;
        }
        if (log.topics[0] === this.channelOpenedTopic) {
            this.knownDeadKeys.delete(key);
            this.freshCandidates = this.freshCandidates.filter(
                (id) => this.channelKey(id) !== key
            );
            this.freshCandidates.unshift(channelIdTopic);
            if (this.freshCandidates.length > MAX_TRACKED_FRESH_CANDIDATES) {
                this.freshCandidates.length = MAX_TRACKED_FRESH_CANDIDATES;
            }
        }
    }

    /**
     * The address + topic filter matching every `ChannelOpened`/
     * `ChannelStorageCleared` log for this contract, with no channelId in
     * `topics[1]` - for a caller to subscribe to and feed into `ingestLog`.
     */
    getDiscoverySubscriptionFilter(): Filter {
        return {
            address: this.contractAddress,
            topics: [[this.channelOpenedTopic, this.channelStorageClearedTopic]]
        };
    }

    private getDiscoveryFilter(fromBlock: number, toBlock: number): Filter {
        return {
            address: this.contractAddress,
            topics: [
                [this.channelOpenedTopic, this.channelStorageClearedTopic]
            ],
            fromBlock,
            toBlock
        };
    }

    /**
     * Logs are only a candidate source - `isChannelOpen` is authoritative.
     * Order-preserving (newest-first in, newest-first out).
     */
    private async confirmOpen(
        candidateIds: readonly ChannelId[]
    ): Promise<ChannelId[]> {
        const confirmed = await Promise.all(
            candidateIds.map(async (channelId) => {
                try {
                    const [isOpen] =
                        await this.contract.isChannelOpen(channelId);
                    return isOpen ? channelId : undefined;
                } catch (error) {
                    this.logger.warn(
                        "ChannelIndex: isChannelOpen check failed; excluding candidate",
                        { channelId, error: String(error) }
                    );
                    return undefined;
                }
            })
        );
        return confirmed.filter((id): id is ChannelId => id !== undefined);
    }

    private channelKey(channelId: ChannelId): ChannelKey {
        return hexlify(channelId).toLowerCase();
    }
}
