// @spec-test-coverage-ignore: recorded Asset Hub trace staging; executable evidence belongs to its calling test declarations
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One block's traces as Asset Hub eth-rpc answered them. */
export type RecordedTrace = {
    recordedAt: string;
    endpoint: string;
    note: string;
    block: number;
    /** `debug_traceBlockByNumber` with the `callTracer`. */
    call: { txHash: string; result: Record<string, unknown> }[];
    /** `debug_traceBlockByNumber` with the `prestateTracer` in `diffMode`. */
    pre: {
        txHash: string;
        result: {
            pre: Record<string, { storage?: Record<string, string> }>;
            post: Record<string, { storage?: Record<string, string> }>;
        };
    }[];
};

/** Real answers recorded from Asset Hub eth-rpc (see the JSON's `note`). */
export const recordedTrace: RecordedTrace = JSON.parse(
    readFileSync(join(__dirname, "assetHubTrace.recorded.json"), "utf8")
);
