// @spec-test-coverage-ignore: real SDK worker teardown fault entry exercised by RuntimeLifecycle tests
import { startRootWorker } from "@/rpc/internal/createRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { createSocket, type Socket } from "node:dgram";
import { workerData } from "node:worker_threads";

/** Longer than every teardown bound, so the timer is still pending when one fires. */
const LEAKED_TIMER_MS = 60 * 60 * 1000;

function bindUdpSocket(): Promise<Socket> {
    const socket = createSocket("udp4");
    return new Promise((resolve) => socket.bind(0, () => resolve(socket)));
}

class TeardownHostRoot extends P2pRuntimeHostRoot {
    // Overrides P2pRuntimeHostRoot.start to install the selected teardown fault.
    public override async start(): Promise<void> {
        await super.start();
        if (workerData.fault === "closing-udp") {
            // A UDP socket its owner closes as the worker closes its handles
            // (a WebRTC ICE socket of a peer connection closed at disposal),
            // listed before an open one the worker must still close itself.
            const closing = await bindUdpSocket();
            await bindUdpSocket();
            const close = this.lifecycle.closeAfterDispose;
            this.lifecycle.closeAfterDispose = async () => {
                closing.close();
                await close?.();
            };
        }
    }

    // Overrides P2pRuntimeHostRoot.dispose to leave a referenced timer behind;
    // closeRootWorker cannot see or close JS timers.
    public override dispose(): Promise<void> {
        if (workerData.fault === "leaked-timer")
            setInterval(() => {}, LEAKED_TIMER_MS);
        return super.dispose();
    }
}

globalThis.threadName = "sdk";
startRootWorker(TeardownHostRoot);
