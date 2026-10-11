import { startRootWorker } from "../createRoot";
import { P2pRuntimeHostRoot } from "../roots/P2pRuntimeHostRoot";

startRootWorker(P2pRuntimeHostRoot, { threadName: "sdk" });
