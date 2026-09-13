// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { LoggerSdkFixture } from "./LoggerServiceFixture";
import { RootCreationControl } from "../runtimeRpc/RootCreationControl";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";

/** Add an actual second port between SDK roots to exercise cyclic gossip. */
export function connectLoggerCycle(sdk: LoggerSdkFixture): () => void {
    const host = [...sdk.roots].find(
        (root): root is P2pRuntimeHostRoot => root instanceof P2pRuntimeHostRoot
    );
    if (!host) throw new Error("Expected actual inline SDK host");
    const channel = createRuntimeChannel();
    const receiving = host.connect<AInternalRpcRoot>(channel.port1, {
        sameRealm: true,
        remoteRelation: "child"
    });
    const sending = sdk.clientRoot.connect<AInternalRpcRoot>(channel.port2, {
        sameRealm: true,
        remoteRelation: "parent"
    });
    return () => {
        receiving["transport"].close(true);
        sending["transport"].close(true);
    };
}

/** Create another real executor after its parent has already gossiped uploads. */
export async function createLateLoggerChild(sdk: LoggerSdkFixture) {
    const host = [...sdk.roots].find(
        (root): root is P2pRuntimeHostRoot => root instanceof P2pRuntimeHostRoot
    );
    if (!host) throw new Error("Expected actual inline SDK host");
    let created: ContractExecutorRoot | undefined;
    const remote = await RootCreationControl.observe(
        () =>
            createRoot(ContractExecutorRoot, {
                parent: host,
                mode: "inline",
                args: { config, customPrecompiles: [] }
            }),
        (root) => {
            if (root instanceof ContractExecutorRoot) created = root;
        }
    );
    if (!created) throw new Error("Executor root was not observed");
    return { remote, root: created };
}

/** Independent SDK instances only share gossip when their roots are explicitly connected. */
export function connectLoggerPeers(
    first: LoggerSdkFixture,
    second: LoggerSdkFixture
): () => void {
    const channel = createRuntimeChannel();
    const child = first.clientRoot.connect(channel.port1, {
        sameRealm: true,
        remoteRelation: "child"
    });
    const parent = second.clientRoot.connect(channel.port2, {
        sameRealm: true,
        remoteRelation: "parent"
    });
    return () => {
        child["transport"].close(true);
        parent["transport"].close(true);
    };
}
