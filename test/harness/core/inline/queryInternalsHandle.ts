import type {
    P2pInternalsInterface,
    ProfileSummary,
    TransportSummary
} from "../interfaces/P2pInternalsInterface";
import type {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import type { TransportType } from "@/transport";
import type ATransport from "@/transport/ATransport";
import { Block } from "@/models";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { TestPeer } from "../types";

// connectionId / kind live on transport subclasses, not the ATransport base.
type TransportRuntime = ATransport & { connectionId?: string; kind?: string };

export class InlineP2pInternalsHandle implements P2pInternalsInterface {
    constructor(private readonly peer: TestPeer) {}

    private get p2pManager() {
        return this.peer.stateManager.p2pManager;
    }

    async openConnections(): Promise<TransportSummary[]> {
        return this.p2pManager.openConnections.map((t) => {
            const rt = t as TransportRuntime;
            return {
                connectionId: rt.connectionId ?? "",
                peerAddress: rt.peerAddress ?? "0x",
                kind: rt.kind ?? "unknown"
            };
        });
    }

    async getProfileByEvmAddress(
        addr: Address
    ): Promise<ProfileSummary | undefined> {
        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(addr);
        if (!profile) return undefined;
        return {
            evmAddress: profile.evmAddress ?? addr,
            connectionId:
                (profile.transport as TransportRuntime | undefined)
                    ?.connectionId ?? ""
        };
    }

    async getProfileByConnectionId(
        connectionId: string
    ): Promise<ProfileSummary | undefined> {
        for (const t of this.p2pManager.openConnections) {
            if ((t as TransportRuntime).connectionId === connectionId) {
                const profile =
                    this.p2pManager.profileManager.getProfileByTransport(t);
                if (!profile) return undefined;
                return { evmAddress: profile.evmAddress, connectionId };
            }
        }
        return undefined;
    }

    async connectionCount(): Promise<number> {
        return this.p2pManager.openConnections.length;
    }

    async isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(otherAddr);
        return profile?.getIsHandshakeCompleted() ?? false;
    }

    async self(): Promise<Address> {
        return this.peer.address;
    }

    async didPeerAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.p2pManager.localRpc.isForkDisputedService.didPeerAcknowledgeDisputedFork(
            String(peerAddress),
            forkId
        );
    }

    async didIAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.p2pManager.localRpc.isForkDisputedService.didIAcknowledgeDisputedFork(
            String(peerAddress),
            forkId
        );
    }

    async requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        return this.p2pManager.localRpc.isForkDisputedService.requestDisputeAcknowledgment(
            channelId,
            forkId
        );
    }

    async respondToDisputeAcknowledgment(
        peerAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        await this.p2pManager.localRpc.isForkDisputedService.respondToDisputeAcknowledgment(
            String(peerAddress),
            channelId,
            forkId
        );
    }

    async onDisputeAcknowledgmentRequest(
        fromAddr: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        const transport = this.requireTransport(fromAddr);
        await this.p2pManager.localRpc.isForkDisputedService
            .createRPCMethods(transport)
            .onDisputeAcknowledgmentRequest(channelId, forkId);
    }

    async onInitHandshakeRequest(
        fromAddr: Address,
        hash: Hash,
        time: Timestamp
    ): Promise<void> {
        const transport = this.requireTransport(fromAddr);
        await this.p2pManager.localRpc.initHandshakeService
            .createRPCMethods(transport)
            .onInitHandshakeRequest(hash, time);
    }

    async onInitHandshakeResponse(
        fromAddr: Address,
        signature: Signature,
        time: Timestamp,
        preferred: TransportType
    ): Promise<void> {
        const transport = this.requireTransport(fromAddr);
        await this.p2pManager.localRpc.initHandshakeService
            .createRPCMethods(transport)
            .onInitHandshakeResponse(signature, time, preferred);
    }

    async initHandshakeTo(toAddr: Address): Promise<void> {
        const transport = this.requireTransport(toAddr);
        this.p2pManager.localRpc.initHandshakeService.initHandshake(transport);
    }

    async getPreferredTransportType(): Promise<number> {
        return this.p2pManager.preferredTransport;
    }

    async getInitChallenge(
        otherAddr: Address
    ): Promise<{ randomChallengeHash: string; initTime: number } | undefined> {
        const transport = this.resolveTransport(otherAddr);
        if (!transport) return undefined;
        const c =
            this.p2pManager.localRpc.initHandshakeService.getChallenge(
                transport
            );
        if (!c) return undefined;
        return {
            randomChallengeHash: c.randomChallengeHash,
            initTime: c.initTime
        };
    }

    async clearInitChallenge(otherAddr: Address): Promise<void> {
        const transport = this.resolveTransport(otherAddr);
        if (!transport) return;
        this.p2pManager.localRpc.initHandshakeService.mapTransportToChallenge.delete(
            transport
        );
    }

    async getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        const transport = this.resolveTransport(otherAddr);
        if (!transport) return { present: false };
        return { present: true, isClosed: transport.isClosed };
    }

    async blockForkIsDisputed(
        block: BlockConfirmationStruct,
        peerAddress: string
    ): Promise<void> {
        const reconstructed = Block.fromBlockConfirmation(block);
        await this.peer.stateManager.blockValidationStrategy.blockForkIsDisputed(
            reconstructed,
            peerAddress
        );
    }

    private resolveTransport(addr: Address): ATransport | undefined {
        const pm = this.p2pManager;
        const target = String(addr).toLowerCase();
        for (const t of pm.openConnections) {
            const profile = pm.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target)
                return t;
        }
        return undefined;
    }

    private requireTransport(addr: Address): ATransport {
        const transport = this.resolveTransport(addr);
        if (!transport)
            throw new Error(
                `InlineP2pInternalsHandle: no transport to ${addr}`
            );
        return transport;
    }
}
