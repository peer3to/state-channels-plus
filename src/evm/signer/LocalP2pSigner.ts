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
import type { Logger } from "@/utils";
import type { ForkId, Hash } from "@/types/types";
import type { PreparedJoinChannelConfirmation } from "@/rpc/services";
import NoopEventProvider from "./NoopEventProvider";
import {
    ChannelAcquisitionCoordinator,
    type AcquireOptions,
    type AcquireResult
} from "@/discovery/ChannelAcquisitionCoordinator";
import { AdKind, type AdId, type ChannelAdStruct } from "@/discovery/ChannelAd";
import LobbyService from "@/rpc/services/lobby/LobbyService";
import { getOptionalRpcService } from "@/utils/optionalRpcService";

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
    // OWNERSHIP — the lobby itself (LobbyService) lives on
    // `p2pManager.localRpc` (opt-in, wired by the app's custom RPC
    // manifest) and is disposed with the P2PManager it belongs to. This
    // class only owns the acquisition coordinator, constructed lazily on
    // the first acquireChannel().
    private acquisition?: ChannelAcquisitionCoordinator;

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
        await this.setChannelId(channelId);

        // Update status to NOT_OPENED/OPENED as soon as we know the channelId.
        await this.p2pManager.stateManager.refreshOpenedStatusFromChain();

        return this.p2pManager.tryOpenConnectionToChannel(channelId.toString());
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

    // ---- Discovery facade --------------------------------------------------
    // This class only ever sees plain data crossing the port. The lobby
    // itself is an opt-in custom RPC service (LobbyService) riding the SAME
    // shared swarm/handshake stack as everything else - this class no
    // longer owns any lobby networking state, it only forwards to
    // `p2pManager.localRpc.lobbyService` when the app has wired one in.

    /** Resolves the opt-in lobby service, or undefined when none is wired. */
    private getLobbyService(): LobbyService | undefined {
        return getOptionalRpcService(
            this.p2pManager.localRpc,
            "lobbyService",
            LobbyService
        );
    }

    private requireLobbyService(): LobbyService {
        const lobbyService = this.getLobbyService();
        if (!lobbyService) {
            throw new Error(
                "Discovery lobby is not enabled; wire lobbyService via a custom RPC manifest to use it"
            );
        }
        return lobbyService;
    }

    public async joinLobby(appNamespace?: string): Promise<{ topic: string }> {
        return this.requireLobbyService().joinLobby(appNamespace);
    }

    public async leaveLobby(): Promise<void> {
        const lobbyService = this.getLobbyService();
        if (!lobbyService) return;
        await lobbyService.leaveLobby();
    }

    public async publishAd(ad: ChannelAdStruct): Promise<{ adId: AdId }> {
        return this.requireLobbyService().publishAd(ad);
    }

    public async withdrawAd(adId: AdId): Promise<void> {
        await this.requireLobbyService().withdrawAd(adId);
    }

    public async listAds(filter?: {
        kind?: AdKind;
        minAmount?: string;
        maxAmount?: string;
    }): Promise<{ encodedAds: string[] }> {
        return {
            encodedAds: this.requireLobbyService()
                .listAds(filter)
                .map((stored) => stored.encodedAd)
        };
    }

    public async acquireChannel(
        options: AcquireOptions
    ): Promise<AcquireResult> {
        // Deliberately NOT requireLobbyService: chain-first discovery joins
        // channels that already exist and never touches the lobby, so a
        // consumer that only wants to join must not be forced to wire one.
        if (!this.acquisition) {
            this.acquisition = new ChannelAcquisitionCoordinator({
                lobby: this.getLobbyService(),
                signer: this,
                logger: this.logger,
                events: this.p2pManager.stateManager.events
            });
        }
        return this.acquisition.acquireChannel(options);
    }

    /** Disposes the lobby if one was ever wired/joined. A no-op otherwise. */
    public async dispose(): Promise<void> {
        this.acquisition = undefined;
        const lobbyService = this.getLobbyService();
        if (!lobbyService) return;
        await lobbyService.dispose();
    }
}

export default LocalP2pSigner;
