import { paramsOf, REVERT_ERROR_CODE } from "./LocalReadParser";
import type { Mirror, MirrorRead } from "./Mirror";
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

/**
 * The revert data of a node's revert answer, as the node provider rejects
 * with it; undefined for any other failure, which is no answer.
 */
function revertDataOf(error: unknown): string | undefined {
    // ethers keeps the node's JSON-RPC error on its own error's `info`
    const answered = (error as { info?: { error?: unknown } } | undefined)?.info
        ?.error as { code?: unknown; data?: unknown } | undefined;
    if (answered?.code !== REVERT_ERROR_CODE) return undefined;
    return typeof answered.data === "string" ? answered.data : "0x";
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
        seen: MirrorRead | undefined
    ): void {
        // after the reply: the caller never waits for a sample
        if (seen && Math.random() < this.sampleRate)
            setTimeout(
                () => void this.checkSample(mirror, request, answer, seen),
                0
            );
    }

    // Asks the node the read `request` was answered locally from `head`, at
    // that block hash, and compares. A revert is an answer: a call that
    // returns here and reverts on the node differs. A node that cannot answer
    // leaves the sample skipped; a difference is logged, and every account
    // the read used drops to lazy reads, fetched from the node from now on:
    // the wrong value may be any of them, a callee's as well as the called.
    private async checkSample(
        mirror: Mirror,
        request: JsonRpcPayload,
        local: JsonRpcResult | JsonRpcError,
        { head, accounts }: MirrorRead
    ): Promise<void> {
        const target = sampleTarget(request);
        if (!target) return;
        try {
            const params = [...paramsOf(request)];
            params[target.tagIndex] = { blockHash: head.hash };
            let remote: { result: unknown } | { revert: string };
            try {
                remote = {
                    result: await this.requestNode(request.method, params)
                };
            } catch (error) {
                const revert = revertDataOf(error);
                // a node that gives no answer leaves the sample skipped
                if (revert === undefined) return;
                remote = { revert };
            }
            // a local answer that is an error is a revert: other failures go to the node
            const same =
                "error" in local
                    ? "revert" in remote &&
                      String(local.error.data ?? "0x").toLowerCase() ===
                          remote.revert.toLowerCase()
                    : "result" in remote &&
                      sameAnswer(request.method, local.result, remote.result);
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
            for (const account of accounts) await mirror.dropToLazy(account);
        } catch (error) {
            // sampling never disturbs a peer: a failed check is only a skipped one
            this.logger.debug("A mirror sample could not be checked", {
                error
            });
        }
    }
}
