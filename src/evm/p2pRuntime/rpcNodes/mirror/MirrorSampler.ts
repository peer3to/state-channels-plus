import type { MirrorBlock } from "./FollowedChain";
import { paramsOf } from "./LocalReadParser";
import type { Mirror } from "./Mirror";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import type { JsonRpcError, JsonRpcPayload, JsonRpcResult } from "ethers";

/** Whether a local and a node answer of `method` are the same. */
function sameAnswer(method: string, local: unknown, remote: unknown): boolean {
    if (typeof local !== "string" || typeof remote !== "string")
        return local === remote;
    if (method === "eth_getBalance" || method === "eth_getTransactionCount")
        return BigInt(local) === BigInt(remote);
    return local.toLowerCase() === remote.toLowerCase();
}

/** Where a sampled read's block tag sits in its params, and the account it reads. */
function sampleTarget(
    request: JsonRpcPayload
): { tagIndex: number; account: string } | undefined {
    const params = paramsOf(request);
    switch (request.method) {
        case "eth_call": {
            const to = (params[0] as { to?: unknown } | undefined)?.to;
            return typeof to === "string"
                ? { tagIndex: 1, account: to }
                : undefined;
        }
        case "eth_getStorageAt":
            return { tagIndex: 2, account: String(params[0]) };
        case "eth_getBalance":
        case "eth_getCode":
        case "eth_getTransactionCount":
            return { tagIndex: 1, account: String(params[0]) };
        default:
            return undefined;
    }
}

/**
 * Re-asks the node a fraction of the reads the mirror answered locally, and
 * drops the account to lazy reads when the node answers differently.
 */
export class MirrorSampler {
    private readonly requestNode: (
        method: string,
        params: unknown[]
    ) => Promise<unknown>;
    private readonly logger: Logger;
    private readonly sampleRate: number;

    constructor(
        requestNode: MirrorSampler["requestNode"],
        logger: Logger,
        sampleRate: number
    ) {
        this.requestNode = requestNode;
        this.logger = logger;
        this.sampleRate = sampleRate;
    }

    /** Checks the local `answer` of `request` against the node for a `sampleRate` fraction of the reads. */
    sample(
        mirror: Mirror,
        request: JsonRpcPayload,
        answer: JsonRpcResult | JsonRpcError,
        head: MirrorBlock | undefined
    ): void {
        // after the reply: the caller never waits for a sample
        if (head && Math.random() < this.sampleRate)
            setTimeout(
                () => void this.checkSample(mirror, request, answer, head),
                0
            );
    }

    // Asks the node the read `request` was answered locally from `head`, at
    // that block hash, and compares. A node that cannot answer leaves the
    // sample skipped; a difference is logged, and the account
    // drops to lazy reads, fetched from the node from now on.
    private async checkSample(
        mirror: Mirror,
        request: JsonRpcPayload,
        local: JsonRpcResult | JsonRpcError,
        head: MirrorBlock
    ): Promise<void> {
        const target = sampleTarget(request);
        if (!target) return;
        try {
            const params = [...paramsOf(request)];
            params[target.tagIndex] = { blockHash: head.hash };
            let remote: unknown;
            let remoteFailed = false;
            try {
                remote = await this.requestNode(request.method, params);
            } catch {
                remoteFailed = true;
            }
            const localFailed = "error" in local;
            // a reverted call fails on the node too; any other failure to ask is no sample
            if (remoteFailed && !localFailed) return;
            const same = localFailed
                ? remoteFailed
                : !remoteFailed &&
                  sameAnswer(
                      request.method,
                      (local as JsonRpcResult).result,
                      remote
                  );
            if (same) return;
            this.logger.warn(
                "A read the mirror answered locally differs from the node's",
                LoggerUtils.getMirrorSampleMetadata(
                    request.method,
                    params,
                    head.hash,
                    target.account
                )
            );
            await mirror.dropToLazy(target.account);
        } catch (error) {
            // sampling never disturbs a peer: a failed check is only a skipped one
            this.logger.debug("A mirror sample could not be checked", {
                error
            });
        }
    }
}
