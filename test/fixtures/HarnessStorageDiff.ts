// @spec-test-coverage-ignore: harness infrastructure that shares one storage diff service per node; executable evidence belongs to the E2E declarations
import { createLogger } from "@/utils/logging";
import { StorageDiffService } from "@/utils/node/storageDiff/StorageDiffService";

// Blocks the shared service keeps for catch-up. It starts once per node, so
// the headers it reads at startup are paid once; a mirror that falls further
// behind clears its cache and reads again.
const SHARED_STORAGE_DIFF_RETENTION = 64;

/** The `ws://` URL of the node a service follows. */
type NodeUrl = string;

type SharedService = { service: StorageDiffService; failed: boolean };

// One service per node for the life of the test process: its cache stays
// valid across tests because the node is the same chain.
const shared = new Map<NodeUrl, Promise<SharedService>>();

async function start(nodeUrl: NodeUrl): Promise<SharedService> {
    const logger = createLogger(
        {},
        { component: "StorageDiffService" },
        { level: "error", attachErrorListener: false }
    );
    const service = await StorageDiffService.start({
        upstreamUrl: nodeUrl,
        port: 0,
        retention: SHARED_STORAGE_DIFF_RETENTION,
        logger
    });
    const entry: SharedService = { service, failed: false };
    // an upstream that was reset ends the service; the next harness starts a new one
    service.closed.then(
        () => logger.dispose(),
        () => {
            entry.failed = true;
            logger.dispose();
        }
    );
    return entry;
}

/**
 * The URL of the storage diff service of `nodeUrl`. The runner starts one
 * beside each slot's chain node and passes it in `STORAGE_DIFF_URL`; that one
 * serves `nodeUrl` when it is the slot's node. Otherwise (the legacy in-process
 * `yarn test`, or a node of the harness's own) the process starts one on first
 * use. A service that has ended (its node was reset, or its upstream failed) is
 * replaced.
 */
export async function sharedStorageDiffUrl(nodeUrl: NodeUrl): Promise<string> {
    const slotUrl = process.env.STORAGE_DIFF_URL;
    const slotNode = process.env.PROVIDER_URL?.replace(/^http/, "ws");
    if (slotUrl && slotNode === nodeUrl) return slotUrl;
    for (let attempt = 0; attempt < 2; attempt++) {
        let entry = shared.get(nodeUrl);
        if (!entry) {
            entry = start(nodeUrl);
            shared.set(nodeUrl, entry);
            entry.catch(() => shared.delete(nodeUrl));
        }
        const current = await entry;
        if (!current.failed) return current.service.url;
        shared.delete(nodeUrl);
    }
    throw new Error("The storage diff service keeps failing");
}

/** Ends the service of `nodeUrl`, for a node the harness is about to stop. */
export async function closeSharedStorageDiff(nodeUrl: NodeUrl): Promise<void> {
    const entry = shared.get(nodeUrl);
    shared.delete(nodeUrl);
    await (await entry?.catch(() => undefined))?.service.close();
}

/** Ends every service, at the end of the test process. */
export async function closeAllSharedStorageDiffs(): Promise<void> {
    await Promise.all([...shared.keys()].map(closeSharedStorageDiff));
}
