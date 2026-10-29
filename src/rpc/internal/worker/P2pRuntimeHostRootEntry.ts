import { startRootWorker } from "../createRoot";
import { P2pRuntimeHostRoot } from "../roots/P2pRuntimeHostRoot";
import { resolveHostRootConstructor } from "../roots/resolveHostRootManifest";

startRootWorker(P2pRuntimeHostRoot, {
    threadName: "sdk",
    resolveRoot: (payload) =>
        resolveHostRootConstructor(payload.hostRootManifest)
});
