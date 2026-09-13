import { startRootWorker } from "../createRoot";
import { P2pRuntimeHostRoot } from "../roots/P2pRuntimeHostRoot";

globalThis.threadName = "sdk";
startRootWorker(P2pRuntimeHostRoot);
