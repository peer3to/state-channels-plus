import type { ByzantineInterface } from "../interfaces/ByzantineInterface";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import StateSnapshot from "@/models/StateSnapshot";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { corruptValidatorSnapshotForBalanceInvariant } from "@test/harness/actions/DisputeTamperingActions";
import type { EventHandler } from "@/eventHandlers/EventHandler";
import type { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import type { TestPeer } from "../types";

export class InlineByzantineHandle implements ByzantineInterface {
    private originalCalldataHandler?: EventHandler["onBlockCalldataPosted"];
    private originalInboundGetLatestBlockHash?: MessageBlockStorage["getLatestBlockHash"];

    constructor(private readonly peer: TestPeer) {}

    async stubCalldataHandler(): Promise<void> {
        const eh = this.peer.stateManager.eventHandler;
        this.originalCalldataHandler = eh.onBlockCalldataPosted.bind(eh);
        eh.onBlockCalldataPosted = async () => {};
    }

    async restoreCalldataHandler(): Promise<void> {
        if (!this.originalCalldataHandler)
            throw new Error(
                "InlineByzantineHandle: no calldata handler captured to restore"
            );
        this.peer.stateManager.eventHandler.onBlockCalldataPosted =
            this.originalCalldataHandler;
        this.originalCalldataHandler = undefined;
    }

    async stubPendingInboundInclusion(): Promise<void> {
        const storage = this.peer.stateManager.storage.inboundMessages;
        this.originalInboundGetLatestBlockHash =
            storage.getLatestBlockHash.bind(storage);
        storage.getLatestBlockHash = () => undefined;
    }

    async restorePendingInboundInclusion(): Promise<void> {
        if (!this.originalInboundGetLatestBlockHash)
            throw new Error(
                "InlineByzantineHandle: no inbound-inclusion stub to restore"
            );
        this.peer.stateManager.storage.inboundMessages.getLatestBlockHash =
            this.originalInboundGetLatestBlockHash;
        this.originalInboundGetLatestBlockHash = undefined;
    }

    async stubBroadcast(): Promise<void> {
        const remoteRpc = this.peer.stateManager.p2pManager.remoteRpc;
        const peerLogger = this.peer.logger;
        const peerIndex = this.peer.index;
        remoteRpc.stateTransitionService.onBlockConfirmation = (() => {
            peerLogger.info("Suppressed broadcast from peer " + peerIndex);
            return {
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            };
        }) as unknown as typeof remoteRpc.stateTransitionService.onBlockConfirmation;
    }

    async submitDoubleSignBlock(
        signedBlockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        this.peer.stateManager.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(signedBlockConfirmation)
            .broadcast();
    }

    async broadcastBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        this.peer.stateManager.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(blockConfirmation)
            .broadcast();
    }

    async storeStateMachineState(
        encodedState: Bytes,
        hash: Hash
    ): Promise<void> {
        this.peer.stateManager.storage.stateMachineStates.storeStateMachineState(
            encodedState,
            { hash }
        );
    }

    async storeStateSnapshot(snapshot: StateSnapshotStruct): Promise<void> {
        this.peer.stateManager.storage.stateSnapshots.storeStateSnapshot(
            StateSnapshot.from(snapshot)
        );
    }

    corruptValidatorSnapshotForBalanceInvariant(forkId: ForkId): Promise<Hash> {
        return Promise.resolve(
            corruptValidatorSnapshotForBalanceInvariant(
                this.peer.stateManager.storage,
                forkId
            )
        );
    }
}
