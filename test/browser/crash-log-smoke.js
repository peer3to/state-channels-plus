// @spec-test-coverage-ignore: browser page fixture driven by the mapped browser worker gate
import { Buffer } from "buffer";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

const { createBrowserSdkExecutor, deployStack, setupBrowserPeer } =
    await import("./sdkSetup.js");
const { createLogger } = await import(
    "../../src/utils/logging/browser/createLogger.ts"
);
const { applyCrashLogConfig, crashLogUploadOverrides } = await import(
    "../fixtures/logging/crashLogConfig.ts"
);

const CRASH_ADDRESS = "0x00000000000000000000000000000000000000bc";
export const MAIN_PEER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
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
    const sdk = await createBrowserSdkExecutor({
        customPrecompiles: [
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
        logger,
        config: crashLogUploadOverrides(uploadEndpoint)
    });
    const { executor } = sdk;
    sdk.instance.logger.updateSharedContext({ channelId: CHANNEL_ID });

    try {
        await executor.simulateCall("0x1234", CRASH_ADDRESS);
        logger.info(MAIN_MARKER);
        const round = await logger.uploadLogs("browser report");
        return {
            ok: round.ok,
            entries: round.entries
        };
    } finally {
        await sdk.dispose();
        logger.dispose();
        restoreConfig();
    }
};

/** Trigger a genuine executor error below an SDK worker, through normal worker bootstrap. */
globalThis.runNestedCrashLogBrowserSmoke = async (uploadEndpoint) => {
    const restoreConfig = applyCrashLogConfig(
        crashLogUploadOverrides(uploadEndpoint)
    );
    const stack = await deployStack(
        globalThis.__SDK_RUNTIME__.providerUrl,
        false
    );
    const signalName = `nested-logger-crash-${crypto.randomUUID()}`;
    const channelId = `0x${"22".repeat(32)}`;
    const logger = createLogger(
        { threadName: "main", channelId },
        { component: "NestedBrowserCrashLog" }
    );
    let instance;
    try {
        instance = await setupBrowserPeer(
            stack.peerWallets[0],
            globalThis.__SDK_RUNTIME__.providerUrl,
            stack.scmAddress,
            {
                peerLogger: logger,
                customPrecompiles: [
                    {
                        address: CRASH_ADDRESS,
                        module: new URL(
                            "./worker-precompile.js",
                            import.meta.url
                        ).href,
                        options: {
                            crashSignal: signalName,
                            expectedData: "0x",
                            value: "42"
                        }
                    }
                ],
                config: {
                    ...crashLogUploadOverrides(uploadEndpoint),
                    RUN_SDK_IN_THREAD: true,
                    VM_DEDICATED_THREAD: true,
                    HOLEPUNCH_RELAYER_URLS: []
                }
            }
        );
        instance.logger.updateSharedContext({ channelId });
        const reported = new Promise((resolve) =>
            instance.onHostError((error) => {
                logger.warn("nested SDK forwarded executor error", {
                    message: error.message
                });
                resolve();
            })
        );
        const signal = new BroadcastChannel(signalName);
        signal.postMessage("crash");
        signal.close();
        await reported;
        const outcome = await logger.uploadLogs("nested browser report");
        // The runner observes receiver arrivals before asking us to dispose the graph.
        globalThis.disposeNestedCrashLogSmoke = async () => {
            await instance.dispose();
            logger.dispose();
            stack.provider.destroy();
            restoreConfig();
        };
        return { ...outcome, channelId };
    } catch (error) {
        await instance?.dispose();
        logger.dispose();
        stack.provider.destroy();
        restoreConfig();
        throw error;
    }
};
