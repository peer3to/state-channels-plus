// @spec-test-coverage-ignore: test-owned setup observation; executable cases are declared in runtime, root and SDK test files
import { RootWorkerControl } from "./RootWorkerControl";
import { RootCreationControl } from "../runtimeRpc/RootCreationControl";
import {
    setupP2pRuntime,
    type P2pSetupDependencies,
    type P2pSetupOptions
} from "@/evm/p2pRuntime/setupP2pRuntime";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type MainRpcService from "@/rpc/network/MainRpcService";
import type {
    AStateMachine,
    StateChannelManagerInterface
} from "@typechain-types";
import type { Worker } from "node:worker_threads";
import type { LocalStateMachineDeployer } from "scripts/V1/deploy";

/** Test-owned entry selection and observation; calls the production setup unchanged. */
export async function setupObservedP2pRuntime<
    T extends AStateMachine,
    TCustomRpc extends MainRpcService = MainRpcService
>(
    scm: StateChannelManagerInterface,
    contract: T,
    deploy: LocalStateMachineDeployer,
    options: P2pSetupOptions | undefined,
    controls: P2pSetupDependencies & {
        workerUrl?: string | URL;
        workerData?: unknown;
        onWorker?: (worker: Worker) => void;
        onRuntimeRoot?: (root: AInternalRpcRoot) => void;
    } = {}
) {
    return RootCreationControl.observe(
        () =>
            RootWorkerControl.run("sdk", controls, () =>
                setupP2pRuntime<T, TCustomRpc>(scm, contract, deploy, options, {
                    hostContext: controls.hostContext
                })
            ),
        controls.onRuntimeRoot
    );
}
