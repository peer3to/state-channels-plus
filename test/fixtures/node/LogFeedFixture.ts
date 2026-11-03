// @spec-test-coverage-ignore: shared helpers of the log feed cases; declarations live in the LogFeed and LogFeedLifecycle test files
import type { MirrorSession } from "./RpcMirrorFixture";
import { VALUE_SET_TOPIC } from "./StorageDiffContracts";
import type { Log } from "ethers";

/** Time is the input: how long a log that must not arrive is watched for. */
export const ABSENCE_WINDOW_MS = 500;

/** The logs a watch of the provider's log feed handed on. */
export type Watch = { logs: Log[]; stop: () => void };

/** Watches `emitter`'s `ValueSet` logs from block `fromBlock` on. */
export function watchEmitter(
    session: MirrorSession,
    emitter: string,
    fromBlock: number
): Watch {
    const logs: Log[] = [];
    const stop = session.provider.logs.watch(
        { address: emitter, topics: [VALUE_SET_TOPIC] },
        fromBlock,
        (log) => logs.push(log)
    );
    return { logs, stop };
}

export function values(watch: Watch): bigint[] {
    return watch.logs.map((log) => BigInt(log.data));
}

/** Each handed-on log as its value and whether it came as removed. */
export function deliveries(watch: Watch): [bigint, boolean][] {
    return watch.logs.map((log) => [BigInt(log.data), log.removed]);
}
