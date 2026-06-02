import type {
    ByzantineHandle,
    SubmitDoubleSignReq
} from "../handles/ByzantineHandle";
import type { TestPeer } from "../types";

type EventHandler = TestPeer["stateManager"]["eventHandler"];
type CalldataHandlerFn = EventHandler["onBlockCalldataPosted"];
type InboundStorage = TestPeer["stateManager"]["storage"]["inboundMessages"];
type InboundGetLatestBlockHashFn = InboundStorage["getLatestBlockHash"];
type StateTransitionService =
    TestPeer["stateManager"]["p2pManager"]["remoteRpc"]["stateTransitionService"];
type OnBlockConfirmationFn = StateTransitionService["onBlockConfirmation"];

export class InlineByzantineHandle implements ByzantineHandle {
    private originalCalldataHandler: CalldataHandlerFn | undefined;
    private originalInboundGetLatestBlockHash:
        | InboundGetLatestBlockHashFn
        | undefined;

    constructor(private readonly peer: TestPeer) {}

    async stubCalldataHandler(): Promise<void> {
        const eh = this.peer.stateManager.eventHandler;
        this.originalCalldataHandler = eh.onBlockCalldataPosted.bind(
            eh
        ) as CalldataHandlerFn;
        eh.onBlockCalldataPosted = (async () => {}) as CalldataHandlerFn;
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
            storage.getLatestBlockHash.bind(
                storage
            ) as InboundGetLatestBlockHashFn;
        storage.getLatestBlockHash = (() =>
            undefined) as InboundGetLatestBlockHashFn;
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
        remoteRpc.stateTransitionService.onBlockConfirmation = ((
            _blockConfirmation: unknown
        ) => {
            peerLogger.info("Suppressed broadcast from peer " + peerIndex);
            return {
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            };
        }) as unknown as OnBlockConfirmationFn;
    }

    async submitDoubleSignBlock(req: SubmitDoubleSignReq): Promise<void> {
        const remoteRpc = this.peer.stateManager.p2pManager.remoteRpc;
        remoteRpc.stateTransitionService
            .onBlockConfirmation(
                req.signedBlockConfirmation as Parameters<OnBlockConfirmationFn>[0]
            )
            .broadcast();
    }

    async broadcastBlockConfirmation(req: {
        blockConfirmation: unknown;
    }): Promise<void> {
        const remoteRpc = this.peer.stateManager.p2pManager.remoteRpc;
        remoteRpc.stateTransitionService
            .onBlockConfirmation(
                req.blockConfirmation as Parameters<OnBlockConfirmationFn>[0]
            )
            .broadcast();
    }
}
