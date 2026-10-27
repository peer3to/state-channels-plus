import AIncludedHeadStrategy, {
    type IncludedHead,
    type IncludedHeadHost
} from "./AIncludedHeadStrategy";
import { parseHeader, toQuantity } from "../blockStorageDiff";

/**
 * Dev and test strategy: the block `depth` behind the best head counts as
 * included. It needs no second chain, and a test picks the depth, so a reorg
 * deeper than `depth` makes the included head leave the best chain. Costs one
 * upstream request per best head: not for production.
 */
export class DepthIncludedHeadStrategy extends AIncludedHeadStrategy {
    private readonly depth: bigint;
    private host?: IncludedHeadHost;
    private closed = false;
    // Best-head requests are applied in order, newest last.
    private tail: Promise<void> = Promise.resolve();

    constructor(depth: number) {
        super();
        if (!Number.isInteger(depth) || depth < 0) {
            throw new Error("depth must be a non-negative integer");
        }
        this.depth = BigInt(depth);
    }

    public async start(host: IncludedHeadHost): Promise<void> {
        this.host = host;
        const latest = parseHeader(
            await host.request("eth_getBlockByNumber", ["latest", false])
        );
        await this.report(latest.number);
    }

    public close(): void {
        this.closed = true;
    }

    public bestHeadCommitted(head: IncludedHead): void {
        this.tail = this.tail.then(() =>
            this.report(head.number).catch((error) =>
                // The next best head asks again.
                this.host?.logger.warn("Could not read the included head", {
                    reason: error instanceof Error ? error.message : "unknown"
                })
            )
        );
    }

    private async report(best: bigint): Promise<void> {
        const host = this.host;
        if (!host || this.closed) return;
        const target = best > this.depth ? best - this.depth : 0n;
        const block = parseHeader(
            await host.request("eth_getBlockByNumber", [
                toQuantity(target),
                false
            ])
        );
        await host.advance({ number: block.number, hash: block.hash });
    }
}
