import type { PeerHandler } from "../../rpc/rpc-server";
import type StateManager from "@/stateManager";
import { ROUTES } from "../routeNames";
import { corruptValidatorSnapshotForBalanceInvariant } from "@test/harness/actions/DisputeTamperingActions";

export class ByzantineRoutes {
    private stateManager?: StateManager;
    private savedCalldataHandler: unknown;
    private savedInboundGetLatestBlockHash: unknown;

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
            eh.onBlockCalldataPosted =
                (async () => {}) as unknown as typeof eh.onBlockCalldataPosted;
            return {};
        });

        server.register(ROUTES.byzantine.restoreCalldataHandler, async () => {
            const original = this.savedCalldataHandler;
            if (!original)
                throw new Error(
                    "byzantine.restoreCalldataHandler: no original captured"
                );
            const eh = this.sm.eventHandler;
            eh.onBlockCalldataPosted =
                original as typeof eh.onBlockCalldataPosted;
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
                storage.getLatestBlockHash =
                    original as typeof storage.getLatestBlockHash;
                this.savedInboundGetLatestBlockHash = undefined;
                return {};
            }
        );

        server.register(ROUTES.byzantine.stubBroadcast, async () => {
            const remoteRpc = this.sm.p2pManager.remoteRpc;
            const stub = () => ({
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            });
            remoteRpc.stateTransitionService.onBlockConfirmation =
                stub as unknown as typeof remoteRpc.stateTransitionService.onBlockConfirmation;
            return {};
        });

        server.register(
            ROUTES.byzantine.broadcastBlockConfirmation,
            async (args) => {
                const { blockConfirmation } = (args ?? {}) as {
                    blockConfirmation?: unknown;
                };
                if (!blockConfirmation)
                    throw new Error(
                        "byzantine.broadcastBlockConfirmation: missing blockConfirmation"
                    );
                const onBlockConfirmation = this.sm.p2pManager.remoteRpc
                    .stateTransitionService.onBlockConfirmation as unknown as (
                    arg: unknown
                ) => { broadcast: () => void };
                onBlockConfirmation(blockConfirmation).broadcast();
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.submitDoubleSignBlock,
            async (args) => {
                const { signedBlockConfirmation } = (args ?? {}) as {
                    signedBlockConfirmation?: unknown;
                };
                if (!signedBlockConfirmation)
                    throw new Error(
                        "byzantine.submitDoubleSignBlock: missing signedBlockConfirmation"
                    );
                const onBlockConfirmation = this.sm.p2pManager.remoteRpc
                    .stateTransitionService.onBlockConfirmation as unknown as (
                    arg: unknown
                ) => { broadcast: () => void };
                onBlockConfirmation(signedBlockConfirmation).broadcast();
                return {};
            }
        );

        server.register(
            ROUTES.byzantine.corruptValidatorSnapshotForBalanceInvariant,
            async (args) => {
                const { forkId } = (args ?? {}) as { forkId?: unknown };
                const storage = this.sm.storage as unknown as Parameters<
                    typeof corruptValidatorSnapshotForBalanceInvariant
                >[0];
                const hash = corruptValidatorSnapshotForBalanceInvariant(
                    storage,
                    forkId as import("@/types/types").ForkId
                );
                return { hash };
            }
        );
    }
}

// Re-export so DisputeTamperingActions imports from one place.
export { corruptValidatorSnapshotForBalanceInvariant } from "@test/harness/actions/DisputeTamperingActions";
