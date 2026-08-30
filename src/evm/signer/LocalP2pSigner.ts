import { ethers, Signer, TransactionResponse } from "ethers";

import {
    TransactionStruct,
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import MainRpcService from "@/rpc/MainRpcService";
import { Address, Bytes } from "@/types/types";
import { Status } from "@/types";
import { channelIdToDiscoveryKey, type Logger } from "@/utils";
import type { ForkId, Hash } from "@/types/types";
import type {
    LobbyJoinOptions,
    LobbyJoinResult,
    PreparedJoinChannelConfirmation
} from "@/rpc/services";
import NoopEventProvider from "./NoopEventProvider";

/**
 * Signer used by the live p2p runtime state manager for channel-scoped
 * transactions and coordination actions.
 */
class LocalP2pSigner<TCustomRpc extends MainRpcService = MainRpcService>
    implements Signer
{
    signer: Signer;
    signerAddress: Address;
    provider: ethers.Provider | null;
    p2pManager: P2PManager<TCustomRpc>;
    logger: Logger;
    //local profile
    isLeader: boolean;

    constructor(
        signer: Signer,
        signerAddress: Address,
        p2pManager: P2PManager<TCustomRpc>
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        // Event-only provider stub: worker-side typed `contract.on(...)`
        // registers without starting a real-chain filter for a local-EVM
        // address -- events are supplied manually via attachContractEvents.
        // Calls and transactions keep delegating to the wrapped signer.
        this.provider = new NoopEventProvider();
        this.p2pManager = p2pManager;
        this.isLeader = false;
        this.logger = p2pManager.logger.child({ component: "P2pSigner" });
    }

    connect(provider: ethers.Provider | null): Signer {
        return this.signer.connect(provider);
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    getNonce(): Promise<number> {
        return this.signer.getNonce();
    }

    populateCall(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateCall(tx);
    }

    populateTransaction(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateTransaction(tx);
    }

    estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
        return this.signer.estimateGas(tx);
    }

    async call(tx: ethers.TransactionRequest): Promise<string> {
        return await this.p2pManager.stateManager.diamondStateMachine.runView(
            tx
        );
    }

    resolveName(name: string): Promise<string | null> {
        return this.signer.resolveName(name);
    }

    signTransaction(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<TransactionResponse> {
        const _tx: TransactionStruct = {
            header: {
                channelId: this.p2pManager.stateManager.channelId,
                participant: this.p2pManager.stateManager.signerAddress,
                forkId: this.p2pManager.stateManager.forkId,
                transactionCnt: BigInt(
                    this.p2pManager.stateManager.storage.blocks.getNextBlockHeight(
                        this.p2pManager.stateManager.forkId
                    )
                ),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: tx.data!,
                data: tx.data!
            }
        };

        this.logger.debug(
            `Sending transaction #${Number(_tx.header.transactionCnt)} timestamp: ${Number(_tx.header.timestamp)}`
        );
        const _blockConfirmation =
            await this.p2pManager.stateManager.blockProductionService.playTransaction(
                _tx
            );
        // NOTE: playTransaction already broadcasts via success() method, no need to broadcast again here

        return "There is no TransactionResponse p2p - everything executed locally" as unknown as TransactionResponse; //TODO
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.signer.signMessage(message);
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.signer.signTypedData(domain, types, value);
    }

    async setChannelId(channelId: Bytes): Promise<void> {
        await this.p2pManager.stateManager.setChannelId(channelId);
    }

    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }

    public getIsLeader() {
        return this.isLeader;
    }

    public async connectToChannel(channelId: Bytes) {
        if (
            this.p2pManager.stateManager.status === Status.DISCOVERING ||
            this.p2pManager.localRpc.lobbyMatchingService.rendezvousTopic
        ) {
            throw new Error(
                "Leave the active lobby before connecting to a channel"
            );
        }
        await this.setChannelId(channelId);

        // Update status to NOT_OPENED/OPENED as soon as we know the channelId.
        await this.p2pManager.stateManager.refreshOpenedStatusFromChain();

        return this.p2pManager.joinDiscoveryKey(
            channelIdToDiscoveryKey(channelId.toString())
        );
    }

    public async joinLobby(
        lobbyTopic: string,
        options: LobbyJoinOptions = {}
    ): Promise<LobbyJoinResult | undefined> {
        if (
            this.p2pManager.isDisposed ||
            this.p2pManager.stateManager.isDisposed
        ) {
            throw new Error("Cannot enter discovery after runtime disposal");
        }
        if (
            options.amount !== undefined &&
            (!Number.isSafeInteger(options.amount) || options.amount < 0)
        ) {
            throw new Error("Invalid local opening amount");
        }
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const negotiation =
            this.p2pManager.localRpc.openChannelNegotiationService;
        let match = await matching.match(lobbyTopic, options.matchTimeoutMs);
        while (match) {
            try {
                await negotiation.initMatchedNegotiation(match, options);
                const outcome = await negotiation.waitForOutcome(
                    match.attemptNonce
                );
                if (outcome.status === "opened") {
                    await matching.completeLobby(lobbyTopic);
                    return outcome.result;
                }
                if (outcome.status === "cancelled") return undefined;
            } catch (error) {
                this.logger.warn("Matched lobby negotiation failed to start", {
                    error:
                        error instanceof Error ? error.message : String(error)
                });
                await matching.releaseNegotiationHandoff(lobbyTopic);
            }
            // Unsigned failures start from a clean discovery session. The
            // matching service leaves the old topic and closes all lobby-owned
            // transports before rejoining this caller-owned topic.
            match = await matching.match(lobbyTopic, options.matchTimeoutMs);
        }
        return undefined;
    }

    public leaveLobby(lobbyTopic: string): Promise<boolean> {
        return this.p2pManager.localRpc.lobbyMatchingService.leaveLobby(
            lobbyTopic
        );
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        return this.p2pManager.stateManager.membershipService.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
    }

    public async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        return this.p2pManager.stateManager.membershipService.topUpBalance(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
    }

    public collectJoinChannelConfirmation(
        joinChannel: JoinChannelStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        return this.p2pManager.localRpc.joinChannelService.collectJoinChannelConfirmation(
            joinChannel
        );
    }

    public disconnectFromPeers() {
        this.p2pManager.disconnectAll();
    }

    public async getChannelStatus(): Promise<Status> {
        return this.p2pManager.stateManager.status;
    }
}

export default LocalP2pSigner;
