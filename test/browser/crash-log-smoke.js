import { Buffer } from "buffer";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

const { default: WorkerContractExecutor } = await import(
    "../../src/evm/contractExecutor/WorkerContractExecutor.ts"
);
const { createLogger } = await import(
    "../../src/utils/logging/browser/createLogger.ts"
);
const { applyCrashLogConfig, crashLogUploadOverrides } = await import(
    "../fixtures/logging/crashLogConfig.ts"
);

const CRASH_ADDRESS = "0x00000000000000000000000000000000000000bc";
export const MAIN_PEER_ADDRESS = "0x00000000000000000000000000000000000000c1";
export const CHANNEL_ID = `0x${"11".repeat(32)}`;
export const MAIN_MARKER = "browser main entry";

/** a browser main realm with a vm worker beneath it: the worker crashes and
 *  collects on its own, then the main realm asks for a collection over the
 *  port. the runner reads what the real server stored. */
globalThis.runCrashLogBrowserSmoke = async (uploadEndpoint) => {
    const restoreConfig = applyCrashLogConfig(
        crashLogUploadOverrides(uploadEndpoint)
    );
    const logger = createLogger(
        {
            threadName: "main",
            peerAddress: MAIN_PEER_ADDRESS,
            channelId: CHANNEL_ID
        },
        { component: "BrowserCrashLogSmoke" }
    );
    const executor = await WorkerContractExecutor.create(
        [
            {
                address: CRASH_ADDRESS,
                module: new URL("./worker-precompile.js", import.meta.url).href,
                options: {
                    expectedData: "0x1234",
                    value: "42",
                    crashAsync: true
                }
            }
        ],
        logger
    );

    try {
        await executor.simulateCall("0x1234", CRASH_ADDRESS);
        logger.info(MAIN_MARKER);
        const round = await logger.uploadLogs("browser report");
        return {
            ok: round.ok,
            failed: round.failed,
            timedOut: round.timedOut,
            entries: round.entries
        };
    } finally {
        await executor.dispose();
        logger.dispose();
        restoreConfig();
    }
};
