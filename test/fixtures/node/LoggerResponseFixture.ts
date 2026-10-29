// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { LoggerSdkFixture } from "./LoggerServiceFixture";
import { RootCreationControl } from "../runtimeRpc/RootCreationControl";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";

/** The inline SDK fixture's host root. */
export function inlineHostOf(sdk: LoggerSdkFixture): P2pRuntimeHostRoot {
    const host = [...sdk.roots].find(
        (root): root is P2pRuntimeHostRoot => root instanceof P2pRuntimeHostRoot
    );
    if (!host) throw new Error("Expected actual inline SDK host");
    return host;
}

/** Add an actual second port between SDK roots to exercise cyclic gossip. */
export function connectLoggerCycle(sdk: LoggerSdkFixture): () => void {
    const host = inlineHostOf(sdk);
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
    const host = inlineHostOf(sdk);
    let created: ContractExecutorRoot | undefined;
    const remote = await RootCreationControl.observe(
        () =>
            createRoot(ContractExecutorRoot, {
                parent: host,
                mode: "inline",
                args: { customPrecompiles: [] }
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

/**
 * Makes the inline SDK host's flush handler (its answer to a neighbour's flush) fail with
 * `error`, since a real flush never fails; returns the restore.
 */
export function failHostFlush(sdk: LoggerSdkFixture, error: Error): () => void {
    const service = inlineHostOf(sdk).logger;
    const original = service.flush.bind(service);
    service.flush = () => Promise.reject(error);
    return () => {
        service.flush = original;
    };
}
