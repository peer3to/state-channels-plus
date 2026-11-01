import type { BlockNumber, FollowedChain, MirrorBlock } from "./FollowedChain";
import { MirrorUnavailableError } from "./MirrorUnavailableError";
import type { StorageDiffSocket } from "./StorageDiffSocket";
import {
    AnnouncedBlocks,
    LearnedBackstop
} from "@/utils/storageDiff/LearnedBackstop";
import type { StorageDiffDelayNotice } from "@/utils/storageDiff/storageDiffWire";
import { toQuantity } from "ethers";

/**
 * What a read waits for before it runs on the mirror's head: the block of
 * the peer's own transaction, and the newest block a node announced. The
 * wait ends when the head holds them, or when the mirror gives up and the
 * read goes to the node.
 */
export class HeadFreshness {
    private readonly chain: FollowedChain;
    private readonly isClosed: () => boolean;
    private readonly currentFeed: () => StorageDiffSocket | undefined;
    private readonly log: (
        level: "warn" | "info" | "debug",
        message: string,
        meta?: Record<string, unknown>
    ) => void;
    /** Reads waiting for the head to move or the mirror to go down. */
    private readonly headWaiters = new Set<() => void>();
    /** When a node announced each block number the head has not reached yet. */
    private readonly announced = new AnnouncedBlocks();
    /** How long a wait for a block lasts when no event ends it, learned from how long records took. */
    private readonly backstop: LearnedBackstop;
    /** Block of the peer's newest own transaction seen mined. */
    private requiredBlock?: MirrorBlock;
    /** Newest block number the nodes announced; reads wait for the head to reach it. */
    private requiredNumber = 0n;
    /** The block the service was last asked about at the start of a wait; reset when the head holds what the peer saw. */
    private probedNumber?: BlockNumber;
    /**
     * A wait ended without the block it waited for (the service said it is
     * late, the node moved on, or the backstop ran out): reads go to the node
     * until the head holds the block the peer saw.
     */
    private behind = false;

    constructor(
        chain: FollowedChain,
        capMs: () => number,
        isClosed: () => boolean,
        currentFeed: () => StorageDiffSocket | undefined,
        log: HeadFreshness["log"]
    ) {
        this.chain = chain;
        this.backstop = new LearnedBackstop(capMs);
        this.isClosed = isClosed;
        this.currentFeed = currentFeed;
        this.log = log;
    }

    /**
     * A read issued from now on waits until the head reaches the block
     * `number` a node announced, so it never answers from before an event
     * the peer already saw.
     */
    requireNumber(number: bigint): void {
        if (number <= this.requiredNumber) return;
        // the node moved on while the mirror still lacks the block it announced
        // before: the service is a whole block behind, so reads go to the node
        const lacking = !this.holds(this.requiredBlock);
        this.requiredNumber = number;
        this.noteAnnounced(number);
        if (lacking) this.giveUpWaiting();
    }

    /** The newest block number a node announced to this runtime. */
    get announcedNumber(): bigint {
        return this.requiredNumber;
    }

    /** The block number a service read names as the one its caller saw, if any. */
    get seenBlock(): string | undefined {
        return this.requiredNumber > 0n
            ? "0x" + this.requiredNumber.toString(16)
            : undefined;
    }

    /** A read issued from now on waits until the mirror applied `block`. */
    requireBlock(block: MirrorBlock): void {
        if (!this.requiredBlock || block.number >= this.requiredBlock.number)
            this.requiredBlock = block;
        this.noteAnnounced(block.number);
    }

    /** Whether the head holds the block the peer saw. */
    holdsRequiredBlock(): boolean {
        return this.holds(this.requiredBlock);
    }

    /**
     * Waits until the mirror holds the block the peer saw. The wait ends at
     * the first of: the block's record arriving (it then returns); the
     * service saying the block is late, or the node announcing a later block
     * while this one is still missing ({@link giveUpWaiting}); the connection
     * dropping (the mirror then does not follow, and the read starts over
     * from the service's head); and, for a service that hangs silently, the
     * learned backstop. A wait that ends without the block throws, so the
     * read goes to the node and never to an older head.
     */
    async waitForRequiredBlock(): Promise<void> {
        const deadline = Date.now() + this.backstop.boundMs;
        for (;;) {
            if (this.isClosed() || this.holds(this.requiredBlock)) {
                this.behind = false;
                this.probedNumber = undefined;
                return;
            }
            if (this.behind) {
                throw new MirrorUnavailableError(
                    "The mirror is behind the node"
                );
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                this.behind = true;
                throw new MirrorUnavailableError(
                    "The block never reached the mirror"
                );
            }
            this.probeService();
            await new Promise<void>((resolve) => {
                const wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(wake, remaining);
                this.headWaiters.add(wake);
            });
        }
    }

    /**
     * The service says a block a read may wait for will not come soon: the
     * wait ends and the read goes to the node. A late block matters only to
     * a wait for a block the head lacks, and for an `upstream-behind` notice
     * only when that wait is for the requested block or later.
     */
    receiveBlockDelay(notice: StorageDiffDelayNotice): void {
        if (this.holds(this.requiredBlock)) return;
        const wanted = this.wantedNumber();
        if (
            notice.reason === "upstream-behind" &&
            wanted < BigInt(notice.requested)
        )
            return;
        this.giveUpWaiting();
    }

    /** Records how long the announced blocks up to `number` took to reach the head. */
    noteArrived(number: BlockNumber): void {
        // a block never applied (orphaned) does not teach how long one takes
        for (const durationMs of this.announced.arrivedUpTo(number))
            this.backstop.record(durationMs);
    }

    /** A block rolled back is no longer the chain's: nothing to wait for. */
    forgetRequiredBlock(hash: string): void {
        if (this.requiredBlock?.hash === hash) this.requiredBlock = undefined;
    }

    /** Forgets every announcement. */
    forgetAnnouncements(): void {
        this.announced.clear();
    }

    /** Wakes the waits for the head, which look at it again. */
    notifyHeadWaiters(): void {
        for (const waiter of [...this.headWaiters]) waiter();
        this.headWaiters.clear();
    }

    /**
     * Asks the service for its head at the block the wait is for, once per
     * wait: a service whose upstream has not seen the block answers with an
     * `upstream-behind` notice at once, which ends the wait; its answer, the
     * head having reached the block, is no end of its own, the wait ends when
     * the record is applied. A failed probe leaves the wait to its events.
     */
    private probeService(): void {
        const wanted = this.wantedNumber();
        const feed = this.currentFeed();
        if (!feed || this.probedNumber === wanted) return;
        this.probedNumber = wanted;
        feed.fetchHead(toQuantity(wanted)).catch((error) => {
            this.log("debug", "Storage diff service head probe failed", {
                error
            });
        });
    }

    /** The newest block number a wait for the head is for. */
    private wantedNumber(): BlockNumber {
        return this.requiredBlock
            ? this.requiredBlock.number > this.requiredNumber
                ? this.requiredBlock.number
                : this.requiredNumber
            : this.requiredNumber;
    }

    /** Ends the waits for a block the head lacks: those reads go to the node. */
    private giveUpWaiting(): void {
        this.behind = true;
        this.notifyHeadWaiters();
    }

    /** Notes when a node announced `number`, to time how long its record takes. */
    private noteAnnounced(number: BlockNumber): void {
        const head = this.chain.head;
        // not following, or already at the block: no wait to time
        if (!head || head.number >= number) return;
        this.announced.announce(number);
    }

    /**
     * Whether the mirror's state includes `block`. Not following counts as
     * including it: the read then starts from the service's best head.
     */
    private holds(block: MirrorBlock | undefined): boolean {
        const base = this.chain.base;
        const head = this.chain.head;
        if (!base || !head) return true;
        if (head.number < this.requiredNumber) return false;
        if (!block) return true;
        return (
            block.number < base.number ||
            this.chain.hashAt(block.number) === block.hash
        );
    }
}
