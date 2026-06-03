import type { PeerHandler } from "../../rpc/PeerHandler";
import type StateManager from "@/stateManager";
import type { Bytes, ForkId, Hash } from "@/types/types";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { EventHandler } from "@/eventHandlers/EventHandler";
import type { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import type RpcHandler from "@/rpc/RpcHandler";
import StateSnapshot from "@/models/StateSnapshot";
import { ROUTES } from "../routeNames";
import { corruptValidatorSnapshotForBalanceInvariant } from "@test/harness/actions/DisputeTamperingActions";

export class ByzantineRoutes {
    private stateManager?: StateManager;
    private savedCalldataHandler?: EventHandler["onBlockCalldataPosted"];
    private savedInboundGetLatestBlockHash?: MessageBlockStorage["getLatestBlockHash"];

    constructor(server: PeerHandler) {
        this.register(server);
    }

    setStateManager(sm: StateManager): void {
        this.stateManager = sm;
    }

    private get sm(): StateManager {
        if (!this.stateManager)
            throw new Error(
                "stateManager not initialized: p2pSetup has not completed"
            );
        return this.stateManager;
    }

    private register(server: PeerHandler): void {
        server.register(ROUTES.byzantine.stubCalldataHandler, async () => {
            const eh = this.sm.eventHandler;
            this.savedCalldataHandler = eh.onBlockCalldataPosted.bind(eh);
            eh.onBlockCalldataPosted = async () => {};
            return {};
        });

        server.register(ROUTES.byzantine.restoreCalldataHandler, async () => {
            const original = this.savedCalldataHandler;
            if (!original)
                throw new Error(
                    "byzantine.restoreCalldataHandler: no original captured"
                );
            const eh = this.sm.eventHandler;
            eh.onBlockCalldataPosted = original;
            this.savedCalldataHandler = undefined;
            return {};
        });

        server.register(
            ROUTES.byzantine.stubPendingInboundInclusion,
            async () => {
                const storage = this.sm.storage.inboundMessages;
                this.savedInboundGetLatestBlockHash =
                    storage.getLatestBlockHash.bind(storage);
                storage.getLatestBlockHash = () => undefined;
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.restorePendingInboundInclusion,
            async () => {
                const original = this.savedInboundGetLatestBlockHash;
                if (!original)
                    throw new Error(
                        "byzantine.restorePendingInboundInclusion: no original captured"
                    );
                const storage = this.sm.storage.inboundMessages;
                storage.getLatestBlockHash = original;
                this.savedInboundGetLatestBlockHash = undefined;
                return {};
            }
        );

        server.register(ROUTES.byzantine.stubBroadcast, async () => {
            const remoteRpc = this.sm.p2pManager.remoteRpc;
            const fakeHandler = {
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            } as unknown as RpcHandler;
            remoteRpc.stateTransitionService.onBlockConfirmation = () =>
                fakeHandler;
            return {};
        });

        server.register(
            ROUTES.byzantine.broadcastBlockConfirmation,
            async ({
                blockConfirmation
            }: {
                blockConfirmation: BlockConfirmationStruct;
            }) => {
                if (!blockConfirmation)
                    throw new Error(
                        "byzantine.broadcastBlockConfirmation: missing blockConfirmation"
                    );
                this.sm.p2pManager.remoteRpc.stateTransitionService
                    .onBlockConfirmation(blockConfirmation)
                    .broadcast();
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.submitDoubleSignBlock,
            async ({
                signedBlockConfirmation
            }: {
                signedBlockConfirmation: BlockConfirmationStruct;
            }) => {
                if (!signedBlockConfirmation)
                    throw new Error(
                        "byzantine.submitDoubleSignBlock: missing signedBlockConfirmation"
                    );
                this.sm.p2pManager.remoteRpc.stateTransitionService
                    .onBlockConfirmation(signedBlockConfirmation)
                    .broadcast();
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.storeStateMachineState,
            async ({
                encodedState,
                hash
            }: {
                encodedState: Bytes;
                hash: Hash;
            }) => {
                if (encodedState === undefined || hash === undefined)
                    throw new Error(
                        "byzantine.storeStateMachineState: missing 'encodedState' or 'hash'"
                    );
                this.sm.storage.stateMachineStates.storeStateMachineState(
                    encodedState,
                    { hash }
                );
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.storeStateSnapshot,
            async ({ snapshot }: { snapshot: StateSnapshotStruct }) => {
                if (!snapshot)
                    throw new Error(
                        "byzantine.storeStateSnapshot: missing 'snapshot'"
                    );
                this.sm.storage.stateSnapshots.storeStateSnapshot(
                    StateSnapshot.from(snapshot)
                );
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.corruptValidatorSnapshotForBalanceInvariant,
            async ({ forkId }: { forkId: ForkId }) => {
                const hash = corruptValidatorSnapshotForBalanceInvariant(
                    this.sm.storage,
                    forkId
                );
                return { hash };
            }
        );
    }
}

// Re-export so DisputeTamperingActions imports from one place.
export { corruptValidatorSnapshotForBalanceInvariant } from "@test/harness/actions/DisputeTamperingActions";
