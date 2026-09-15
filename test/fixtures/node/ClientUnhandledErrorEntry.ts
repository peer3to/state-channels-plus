// @spec-test-coverage-ignore: isolate the client's real unhandled-rejection policy
import { rootStartContext } from "@/rpc/internal/createRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { parentPort, workerData } from "node:worker_threads";

const root = new P2pRuntimeClientRoot(
    workerData,
    {},
    rootStartContext(undefined, "inline")
);
process.once("unhandledRejection", (error: Error) => {
    parentPort!.postMessage({ message: error.message });
    void root.dispose().then(() => parentPort!.close());
});
root.reportError(new Error("unobserved host failure"));
