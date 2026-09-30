// @spec-test-coverage-ignore: records the local owner a custom RPC receives; evidence belongs to RootCreation tests
import { ReadyLifecycleRpc } from "./ReadyLifecycleRpcManifest";
import type P2PManager from "@/P2PManager";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { CustomRpcContext } from "@/rpc/network/registry";
import { config } from "@/utils/config";

export type OwnerContextRecord = {
    owner: AInternalRpcRoot;
    // Whether the owner's runtime was already built (and could be ready)
    // when this custom RPC was constructed.
    ownerRuntimeBuiltAtConstruction: boolean;
    child: Promise<RemoteRoot<ContractExecutorRoot>>;
};

/**
 * Live records in the realm that builds each inline runtime; they never cross
 * a port. Tests read them after setup to compare actual root instances.
 */
export const ownerContextRecords: OwnerContextRecord[] = [];

/** A consumer RPC that creates one real child under the owner it receives. */
export class OwnerContextRpc extends ReadyLifecycleRpc {
    private readonly child: Promise<RemoteRoot<ContractExecutorRoot>>;

    constructor(
        p2pManager: P2PManager<OwnerContextRpc>,
        options: undefined,
        context: CustomRpcContext
    ) {
        super(p2pManager, options);
        this.child = createRoot(ContractExecutorRoot, {
            parent: context.owner,
            mode: "inline",
            args: { config, customPrecompiles: [] }
        });
        // Observed through the record; construction does not await startup.
        this.child.catch(() => undefined);
        ownerContextRecords.push({
            owner: context.owner,
            // The host stores its runtime handle only after this constructor.
            ownerRuntimeBuiltAtConstruction:
                Reflect.get(context.owner, "runtimeHandle") !== undefined,
            child: this.child
        });
    }

    // Overrides MainRpcService.dispose: the creator also releases its child;
    // the owner's cascade may already have done so.
    public override async dispose(): Promise<void> {
        await (await this.child.catch(() => undefined))?.dispose();
        await super.dispose();
    }
}

export default OwnerContextRpc;
