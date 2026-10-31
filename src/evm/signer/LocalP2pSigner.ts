import type { ConnectToChannelOptions } from "./ConnectToChannelOptions";
import NoopEventProvider from "./NoopEventProvider";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import MainRpcService from "@/rpc/network/MainRpcService";
import type {
    LobbyJoinOptions,
    LobbyJoinResult,
    PreparedJoinChannelConfirmation
} from "@/rpc/network/services";
import type { LobbyMatch } from "@/rpc/network/services/lobbyMatching/LobbyMatchingTypes";
import { validateMatchTimeout } from "@/rpc/network/services/lobbyMatching/LobbyMatchingValidation";
import { DEFAULT_JOIN_AMOUNT } from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type {
    MatchedNegotiationOptions,
    NegotiationOutcome
} from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { OpenConnection } from "@/transport/TransportType";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import { Address, Bytes } from "@/types/types";
import type { ForkId, Hash } from "@/types/types";
import {
    channelIdToDiscoveryKey,
    channelIdToTargetedJoinTopic,
    type Logger
} from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import {
    BalanceStruct,
    TransactionStruct,
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, Signer, TransactionResponse } from "ethers";

/** An ordinary lobby join in flight, with its normalized topic. */
type LobbyJoin = {
    topic: string;
    /** A leave marked it; matching never starts for a marked join. */
    left: boolean;
    /** Its negotiation opened a channel. */
    opened: boolean;
    /** Resolves when the join has settled, whatever its outcome. */
    ended: Promise<void>;
};

/** A targeted connect that may still start matching. */
type TargetedConnect = {
    topic: string;
    /** A cancel marked it; matching never starts for a marked connect. */
    cancelled: boolean;
};

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
    // ordinary lobby joins in flight; a leave marks every join on its topic
    // and waits until they have settled
    lobbyJoins = new Set<LobbyJoin>();
    // targeted connects that have not ended their matching step; a cancel
    // that finds no running matching marks every one on its topic
    targetedConnects = new Set<TargetedConnect>();

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
        return this.runConnectToChannel(channelId, options ?? {});
    }

    /**
     * Cancels a targeted connect before match acceptance. A connect whose
     * matching has not started yet is marked, so it ends `false` without
     * starting matching; a running matching is cancelled by its owner.
     */
    public cancelConnectToChannel(channelId: Bytes): Promise<boolean> {
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = channelIdToTargetedJoinTopic(ethers.hexlify(channelId));
        if (matching.rendezvousTopic === topic)
            return matching.cancelMatching(topic);
        const connects = [...this.targetedConnects].filter(
            (connect) => connect.topic === topic
        );
        for (const connect of connects) connect.cancelled = true;
        return Promise.resolve(connects.length > 0);
    }

    /** Starts this runtime's leave; `onLeftChannel` reports its end. */
    public leaveChannel(): void {
        this.p2pManager.stateManager.leaveChannelService.leaveChannel();
    }

    public async joinLobby(
        lobbyTopic: string,
        options: LobbyJoinOptions = {}
    ): Promise<LobbyJoinResult | undefined> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "joinLobby"
        );
        let end!: () => void;
        const join: LobbyJoin = {
            topic: this.p2pManager.localRpc.lobbyMatchingService.validateTopic(
                lobbyTopic
            ),
            left: false,
            opened: false,
            ended: new Promise<void>((resolve) => {
                end = resolve;
            })
        };
        validateMatchTimeout(options.matchTimeoutMs);
        this.lobbyJoins.add(join);
        try {
            const balance = options.balance ?? this.defaultBalance();
            await this.p2pManager.stateManager.diamondStateMachine.requirePositiveBalance(
                balance,
                "Balance"
            );
            if (
                String(this.p2pManager.stateManager.channelId) !==
                ethers.ZeroHash
            ) {
                throw new Error(
                    "Ordinary discovery requires no selected channel"
                );
            }
            this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
            return await this.runLobbyJoin(join, {
                balance,
                matchTimeoutMs: options.matchTimeoutMs
            });
        } finally {
            this.lobbyJoins.delete(join);
            end();
        }
    }

    /**
     * Ends every ordinary lobby join on `lobbyTopic` and waits until they have
     * settled. True means this runtime is out of the lobby with no channel;
     * false means the leave changed nothing: no join was on the topic, or a
     * join's negotiation opened a channel first.
     */
    public async leaveLobby(lobbyTopic: string): Promise<boolean> {
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = matching.validateTopic(lobbyTopic);
        const joins = [...this.lobbyJoins].filter(
            (join) => join.topic === topic
        );
        if (joins.length === 0) return false;
        for (const join of joins) join.left = true;
        await matching.cancelMatching(topic);
        await Promise.all(joins.map((join) => join.ended));
        return joins.every((join) => !join.opened);
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        this.p2pManager.stateManager.leaveChannelService.assertOperationAllowed(
            "joinChannel"
        );
        return this.p2pManager.stateManager.channelJoinService.joinChannel(
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
        return this.p2pManager.stateManager.channelJoinService.topUpBalance(
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

    /** This runtime's active peer connections and their transport types. */
    public async getOpenConnections(): Promise<OpenConnection[]> {
        return this.p2pManager.getOpenConnections();
    }

    private async runConnectToChannel(
        channelId: Bytes,
        options: ConnectToChannelOptions
    ): Promise<boolean> {
        const normalizedChannelId = ethers.hexlify(channelId);
        if (!ethers.isHexString(normalizedChannelId, 32))
            throw new Error("Channel ID must be exactly 32 bytes");
        const stateManager = this.p2pManager.stateManager;
        stateManager.leaveChannelService.assertOperationAllowed(
            "connectToChannel"
        );
        let openedGenesis = false;
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = channelIdToTargetedJoinTopic(normalizedChannelId);
        const connect: TargetedConnect = { topic, cancelled: false };
        if (options.autoOpen) this.targetedConnects.add(connect);
        let isTargetUnopened: boolean;
        let match: LobbyMatch | undefined;
        try {
            if (String(stateManager.channelId) !== normalizedChannelId) {
                if (String(stateManager.channelId) !== ethers.ZeroHash) {
                    throw new Error(
                        `This P2P runtime already owns channel ${stateManager.channelId}; leave it and create a new runtime before selecting ${normalizedChannelId}`
                    );
                }
                await stateManager.setChannelId(normalizedChannelId);
            }
            await stateManager.refreshOpenedStatusFromChain();
            isTargetUnopened = stateManager.status === Status.NOT_OPENED;
            if (isTargetUnopened && options.autoOpen && !connect.cancelled) {
                match = await matching.match(
                    topic,
                    options.timeoutMs,
                    normalizedChannelId,
                    () => connect.cancelled
                );
            }
        } finally {
            this.targetedConnects.delete(connect);
        }
        if (connect.cancelled) return false;
        if (isTargetUnopened) {
            if (!options.autoOpen) return false;
            if (!match) {
                if (!matching.takeObservedTargetOpen(normalizedChannelId))
                    return false;
            } else {
                await stateManager.refreshOpenedStatusFromChain();
                if (stateManager.status === Status.NOT_OPENED) {
                    const outcome = await this.negotiateOrRelease(
                        match,
                        topic,
                        {
                            mode: "targeted",
                            channelId: normalizedChannelId,
                            balance: options.balance ?? this.defaultBalance()
                        }
                    );
                    if (outcome.status === "opened") {
                        openedGenesis = true;
                        await matching.completeLobby(topic);
                    } else if (outcome.status !== "observed-target-open") {
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
        if (isCommittedParticipantStatus(stateManager.status)) {
            if (openedGenesis) return true;
            if (!options.balance) return true;
            return stateManager.channelJoinService.collectAndTopUp(
                options.balance
            );
        }
        if (stateManager.status !== Status.SYNCED) return false;
        return stateManager.channelJoinService.collectAndJoinChannel(
            options.balance ?? this.defaultBalance(),
            options.shouldSpectateWhenFull ?? false
        );
    }

    private async runLobbyJoin(
        join: LobbyJoin,
        options: LobbyJoinOptions
    ): Promise<LobbyJoinResult | undefined> {
        const lobbyTopic = join.topic;
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        const left = () => join.left;
        let match = await matching.match(
            lobbyTopic,
            options.matchTimeoutMs,
            undefined,
            left
        );
        while (match) {
            let outcome: NegotiationOutcome | undefined;
            try {
                outcome = await this.negotiateOrRelease(match, lobbyTopic, {
                    mode: "ordinary",
                    balance: options.balance
                });
            } catch (error) {
                this.logger.warn("Matched lobby negotiation failed to start", {
                    error: errorMessage(error)
                });
            }
            if (outcome?.status === "opened") {
                join.opened = true;
                await matching.completeLobby(lobbyTopic);
                // Announce the opened channel as a direct connect does, so
                // spectators and joiners can find its participants.
                await this.p2pManager.joinDiscoveryKey(
                    channelIdToDiscoveryKey(outcome.result.channelId)
                );
                return outcome.result;
            }
            if (outcome?.status === "cancelled") return undefined;
            // Unsigned failures start from a clean discovery session. The
            // matching service leaves the old topic and closes all lobby-owned
            // transports before rejoining this caller-owned topic.
            match = await matching.match(
                lobbyTopic,
                options.matchTimeoutMs,
                undefined,
                left
            );
        }
        return undefined;
    }

    /**
     * Negotiates a committed lobby match. The commitment promoted the
     * selected peer, so every outcome but an open, and a failed start,
     * releases it; the caller completes the lobby after an open.
     */
    private async negotiateOrRelease(
        match: LobbyMatch,
        topic: string,
        options: MatchedNegotiationOptions
    ): Promise<NegotiationOutcome> {
        const matching = this.p2pManager.localRpc.lobbyMatchingService;
        let outcome: NegotiationOutcome;
        try {
            outcome =
                await this.p2pManager.localRpc.openChannelNegotiationService.initMatchedNegotiation(
                    match,
                    options
                );
        } catch (error) {
            await matching.releaseNegotiationHandoff(topic);
            throw error;
        }
        if (outcome.status !== "opened")
            await matching.releaseNegotiationHandoff(topic);
        return outcome;
    }

    private defaultBalance(): BalanceStruct {
        return { amount: BigInt(DEFAULT_JOIN_AMOUNT), data: "0x" };
    }
}

export default LocalP2pSigner;
