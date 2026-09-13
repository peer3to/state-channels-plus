// @spec-test-coverage-ignore: real executor call held across worker failure or disposal
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { BroadcastChannel, workerData } from "node:worker_threads";

class TwoHopExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.start: hold the real engine call after startup.
    public override async start(): Promise<void> {
        await super.start();
        const channel = new BroadcastChannel(workerData.channel);
        channel.unref();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        channel.onmessage = (event) => {
            const data = (event as MessageEvent).data;
            if (data === "release") release();
            if (data === "exit-executor") process.exit(29);
        };
        const engine = this.executor.getExecutor();
        const execute = engine.executeCall.bind(engine);
        engine.executeCall = async (...args) => {
            channel.ref();
            channel.postMessage("executing");
            await held;
            return execute(...args);
        };
    }
}

globalThis.threadName = "vm";
startRootWorker(TwoHopExecutorRoot);
