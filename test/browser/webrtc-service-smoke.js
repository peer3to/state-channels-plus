// @spec-test-coverage-ignore: browser page script for the WebRTC smokes; evidence is mapped from run-worker-contract-executor.mjs
import { withBridge } from "./runtimeWebRTC.js";
import { createBrowserSdkExecutor } from "./sdkSetup.js";
import { P2pRuntimeClientRoot } from "../../src/rpc/internal/roots/P2pRuntimeClientRoot.ts";
import { installWebRTCMainThreadBridge } from "@/rpc/internal/roots/WebRTCMainThreadBridge";

function waitFor(predicate, label) {
    const deadline = Date.now() + 15_000;
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const result = predicate();
                if (result) return resolve(result);
                if (Date.now() > deadline)
                    throw new Error(`${label} timed out`);
                setTimeout(tick, 20);
            } catch (error) {
                reject(error);
            }
        };
        tick();
    });
}

globalThis.runWebRTCMainThreadBrowserSmoke = () =>
    withBridge(
        async ({ connect }) => {
            let exchange;
            await connect(undefined, (result) => {
                exchange = result;
            });
            return {
                receivedByInitiator: exchange.received,
                receivedByResponder: exchange.incoming
            };
        },
        { local: true }
    );

async function runWebRTCWorkerBridgeSmoke(options = {}) {
    let owner;
    const sdk = await createBrowserSdkExecutor({
        onRuntimeRoot(root) {
            if (root instanceof P2pRuntimeClientRoot) owner = root;
        }
    });
    const brokers = [];
    const worker = new Worker(
        new URL("./webrtc-service-worker.js", import.meta.url),
        { type: "module" }
    );
    const remote = new RTCPeerConnection();
    const received = [];
    const candidates = [];
    const errors = [];
    let channel;
    let workerResult;
    let disposed = false;
    let readyHosts = 0;
    remote.onicecandidate = ({ candidate }) => {
        if (candidate)
            worker.postMessage({ type: "ice", candidate: candidate.toJSON() });
    };
    remote.ondatachannel = ({ channel: incoming }) => {
        channel = incoming;
        channel.onmessage = ({ data }) => received.push(data);
    };
    worker.onerror = (event) => errors.push(new Error(event.message));
    worker.onmessage = ({ data }) => {
        if (data.type === "error") errors.push(new Error(data.message));
        if (data.type === "host-ready") readyHosts++;
        if (data.type === "bridge") {
            brokers.push(
                installWebRTCMainThreadBridge(data.port, {
                    ...options,
                    logger: sdk.instance.logger.child({
                        component: "TestBridge"
                    })
                })
            );
        }
        if (data.type === "ice") {
            if (remote.remoteDescription)
                void remote
                    .addIceCandidate(data.candidate)
                    .catch((error) => errors.push(error));
            else candidates.push(data.candidate);
        }
        if (data.type === "result") workerResult = data;
        if (data.type === "disposed") disposed = true;
        if (data.type === "offer") {
            void (async () => {
                await remote.setRemoteDescription(data.offer);
                await remote.setLocalDescription(await remote.createAnswer());
                for (const candidate of candidates.splice(0))
                    await remote.addIceCandidate(candidate);
                worker.postMessage({
                    type: "answer",
                    answer: remote.localDescription.toJSON()
                });
            })().catch((error) => errors.push(error));
        }
    };
    const check = (predicate) => {
        if (errors.length) throw errors[0];
        return predicate();
    };
    try {
        // The actual SDK in the application worker owns the client side; the
        // main SDK owns the broker and its transferred bridge port.
        worker.postMessage({
            type: "start",
            runtime: globalThis.__SDK_RUNTIME__,
            disposeIndex: options.disposeIndex
        });
        // Each real SDK setup gets its own readiness boundary before channel negotiation.
        const hostCount = options.disposeIndex === undefined ? 1 : 2;
        for (let count = 1; count <= hostCount; count++)
            await waitFor(
                () => check(() => readyHosts >= count),
                "worker SDK setup"
            );
        await waitFor(
            () => check(() => channel?.readyState === "open"),
            "worker channel open"
        );
        for (const candidate of candidates.splice(0))
            await remote.addIceCandidate(candidate);
        channel.send("main-to-worker");
        await waitFor(
            () =>
                check(
                    () => workerResult && received.includes("worker-to-main")
                ),
            "duplex worker messages"
        );
        return {
            receivedByMain: received.length,
            receivedByWorker: workerResult.received,
            transferredChannel: workerResult.transferredChannel
        };
    } finally {
        worker.postMessage({ type: "dispose" });
        try {
            await waitFor(() => disposed, "worker SDK disposal");
        } finally {
            remote.close();
            worker.terminate();
            for (const broker of brokers) broker.dispose();
            await sdk.dispose();
        }
    }
}

globalThis.runWebRTCDedicatedWorkerBrowserSmoke = () =>
    runWebRTCWorkerBridgeSmoke();

// Force the proxy path: channel traffic is relayed over the bridge rather than
// handed to the worker as a transferred RTCDataChannel. Chromium supports
// channel transfer, so without forcing this the proxy path (the one
// Firefox/Safari always take) is never exercised end-to-end.
globalThis.runWebRTCProxyWorkerBrowserSmoke = () =>
    runWebRTCWorkerBridgeSmoke({ channelMode: "proxy" });

globalThis.runWebRTCFirstHostDisposal = () =>
    runWebRTCWorkerBridgeSmoke({ channelMode: "proxy", disposeIndex: 0 });
globalThis.runWebRTCSecondHostDisposal = () =>
    runWebRTCWorkerBridgeSmoke({ channelMode: "proxy", disposeIndex: 1 });
