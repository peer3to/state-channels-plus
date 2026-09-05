import { ethers, Signer, TransactionResponse } from "ethers";

import {
    BalanceStruct,
    TransactionStruct,
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import MainRpcService from "@/rpc/MainRpcService";
import { Address, Bytes } from "@/types/types";
import { Status } from "@/types";
import {
    channelIdToDiscoveryKey,
    channelIdToTargetedJoinTopic,
    type Logger
} from "@/utils";
import type { ForkId, Hash } from "@/types/types";
import type {
    LobbyJoinOptions,
    LobbyJoinResult,
    PreparedJoinChannelConfirmation
} from "@/rpc/services";
import NoopEventProvider from "./NoopEventProvider";
import type { ConnectToChannelOptions } from "./ConnectToChannelOptions";
import { DEFAULT_JOIN_AMOUNT } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";

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

    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }

    public getIsLeader() {
        return this.isLeader;
    }

    public async connectToChannel(
        channelId: Bytes,
        options: ConnectToChannelOptions | null = {}
    ): Promise<boolean> {
        options ??= {};
        const normalizedChannelId = ethers.hexlify(channelId);
        if (!ethers.isHexString(normalizedChannelId, 32))
            throw new Error("Channel ID must be exactly 32 bytes");
        const stateManager = this.p2pManager.stateManager;
        stateManager.leaveChannelService.assertOperationAllowed(
            "connectToChannel"
        );
        let openedGenesis = false;

        if (String(stateManager.channelId) !== normalizedChannelId) {
            if (String(stateManager.channelId) !== ethers.ZeroHash) {
                throw new Error(
                    `This P2P runtime already owns channel ${stateManager.channelId}; leave it and create a new runtime before selecting ${normalizedChannelId}`
                );
            }
            await stateManager.setChannelId(normalizedChannelId);
        }

        await stateManager.refreshOpenedStatusFromChain();
        if (stateManager.status === Status.NOT_OPENED) {
            if (!options.autoOpen) return false;
            const matching = this.p2pManager.localRpc.lobbyMatchingService;
            const topic = channelIdToTargetedJoinTopic(normalizedChannelId);
            const match = await matching.match(
                topic,
                options.timeoutMs,
                normalizedChannelId
            );
            if (!match) {
                if (!matching.takeObservedTargetOpen(normalizedChannelId))
                    return false;
            } else {
                await stateManager.refreshOpenedStatusFromChain();
                if (stateManager.status === Status.NOT_OPENED) {
                    const outcome =
                        await this.p2pManager.localRpc.openChannelNegotiationService.initMatchedNegotiation(
                            match,
                            {
                                mode: "targeted",
                                channelId: normalizedChannelId,
                                balance:
                                    options.balance ?? this.defaultBalance()
                            }
                        );
                    if (outcome.status === "opened") {
                        openedGenesis = true;
                        await matching.completeLobby(topic);
                    } else if (outcome.status === "observed-target-open") {
                        await matching.releaseNegotiationHandoff(topic);
                    } else {
                        await matching.releaseNegotiationHandoff(topic);
                        return false;
                    }
                } else {
                    await matching.releaseNegotiationHandoff(topic);
                }
            }
        }

        await stateManager.refreshOpenedStatusFromChain();
        if (stateManager.status === Status.NOT_OPENED) return false;
        await this.p2pManager.joinDiscoveryKey(
            channelIdToDiscoveryKey(normalizedChannelId)
        );
        if (!options.shouldJoin) {
            return (
                stateManager.status === Status.SYNCED ||
                stateManager.status === Status.PARTICIPATING
            );
        }
        if (
            stateManager.status === Status.PENDING_PARTICIPANT ||
            stateManager.status === Status.PARTICIPATING
        ) {
            if (openedGenesis) return true;
            if (!options.balance) return true;
            const prepared =
                await this.p2pManager.localRpc.joinChannelService.prepareJoinChannelConfirmation(
                    options.balance
                );
            return stateManager.membershipService.topUpBalance(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
        }
        if (stateManager.status !== Status.SYNCED) return false;
        const prepared =
            await this.p2pManager.localRpc.joinChannelService.prepareJoinChannelConfirmation(
                options.balance ?? this.defaultBalance()
            );
        return stateManager.membershipService.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
    }

    public cancelConnectToChannel(channelId: Bytes): Promise<boolean> {
        return this.p2pManager.localRpc.lobbyMatchingService.cancelMatching(
            channelIdToTargetedJoinTopic(ethers.hexlify(channelId))
        );
    }

    /**
     * Internal route for `P2pInstance.leaveChannel`.
     * Direct callers wait for settled removal but do not dispose the runtime.
     */
    public leaveChannel(): Promise<void> {
        return this.p2pManager.stateManager.leaveChannelService.leaveChannel();
    }

    public async joinLobby(
        lobbyTopic: string,
        options: LobbyJoinOptions = {}
    ): Promise<LobbyJoinResult | undefined> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "joinLobby"
        );
        if (!ethers.isHexString(lobbyTopic, 32)) {
            throw new Error("Rendezvous topic must be exactly 32 bytes");
        }
        if (
            options.matchTimeoutMs !== undefined &&
            options.matchTimeoutMs !== null &&
            (!Number.isSafeInteger(options.matchTimeoutMs) ||
                options.matchTimeoutMs <= 0)
        ) {
            throw new Error("Lobby match timeout must be a positive integer");
        }
        const balance = options.balance ?? this.defaultBalance();
        await this.requirePositiveBalance(balance);
        if (
            String(this.p2pManager.stateManager.channelId) !== ethers.ZeroHash
        ) {
            throw new Error("Ordinary discovery requires no selected channel");
        }
        this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
        return this.runLobbyJoin(lobbyTopic, {
            balance,
            matchTimeoutMs: options.matchTimeoutMs
        });
    }

    private async runLobbyJoin(
        lobbyTopic: string,
        options: LobbyJoinOptions
    ): Promise<LobbyJoinResult | undefined> {
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const negotiation =
            this.p2pManager.localRpc.openChannelNegotiationService;
        let match = await matching.match(lobbyTopic, options.matchTimeoutMs);
        while (match) {
            try {
                const outcome = await negotiation.initMatchedNegotiation(
                    match,
                    {
                        mode: "ordinary",
                        balance: options.balance
                    }
                );
                if (outcome.status === "opened") {
                    await matching.completeLobby(lobbyTopic);
                    return outcome.result;
                }
                if (outcome.status === "cancelled") return undefined;
                await matching.releaseNegotiationHandoff(lobbyTopic);
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
        return this.p2pManager.localRpc.lobbyMatchingService.cancelMatching(
            lobbyTopic
        );
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "joinChannel"
        );
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
    ): Promise<boolean> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "topUpBalance"
        );
        return this.p2pManager.stateManager.membershipService.topUpBalance(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
    }

    public collectJoinChannelConfirmation(
        joinChannel: JoinChannelStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "collectJoinChannelConfirmation"
        );
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

    private defaultBalance(): BalanceStruct {
        return { amount: BigInt(DEFAULT_JOIN_AMOUNT), data: "0x" };
    }

    private async requirePositiveBalance(
        balance: BalanceStruct
    ): Promise<void> {
        const zeroBalance =
            await this.p2pManager.stateManager.diamondStateMachine.getZeroBalance();
        if (
            !(await this.p2pManager.stateManager.diamondStateMachine.isBalanceLesserThan(
                zeroBalance,
                balance
            ))
        ) {
            throw new Error("Balance must be greater than zero");
        }
    }
}

export default LocalP2pSigner;
