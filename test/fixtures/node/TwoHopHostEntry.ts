// @spec-test-coverage-ignore: SDK worker owning a real scripted executor worker
import { RootWorkerControl } from "./RootWorkerControl";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import type { SetupPayload } from "@/evm/p2pRuntime/types";
import {
    startRootWorker,
    type RootStartContext
} from "@/rpc/internal/createRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import type { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { Interface } from "ethers";
import { BroadcastChannel, workerData } from "node:worker_threads";

class TwoHopHostRoot extends P2pRuntimeHostRoot {
    constructor(
        payload: SetupPayload,
        _local: undefined,
        context: RootStartContext
    ) {
        super(
            payload,
            {
                createContractExecutor: (options, owner) =>
                    RootWorkerControl.run(
                        "vm",
                        {
                            workerUrl: require.resolve("./TwoHopExecutorEntry"),
                            workerData: { channel: workerData.channel }
                        },
                        () => createContractExecutor(options, owner)
                    )
            },
            context
        );
    }

    // Overrides P2pRuntimeHostRoot.start: request a real executor call through the SDK hop.
    public override async start(): Promise<void> {
        await super.start();
        const build = this.sdkSetup["buildRuntime"];
        Object.defineProperty(this.sdkSetup, "buildRuntime", {
            value: async (...args: Parameters<typeof build>) => {
                await build(...args);
                const channel = new BroadcastChannel(workerData.channel);
                channel.unref();
                const child = [
                    ...this.children
                ][0] as RemoteRoot<ContractExecutorRoot>;
                const abi = new Interface([
                    "function getSum() view returns (uint256)"
                ]);
                channel.onmessage = (event) => {
                    if ((event as MessageEvent).data !== "call") return;
                    void child.rpc.executor
                        .executeCall(abi.encodeFunctionData("getSum"), args[0])
                        .request()
                        .then(
                            () => channel.postMessage("call-complete"),
                            (error: Error) =>
                                channel.postMessage({ rejected: error.message })
                        );
                };
            }
        });
    }
}

globalThis.threadName = "sdk";
startRootWorker(TwoHopHostRoot);
