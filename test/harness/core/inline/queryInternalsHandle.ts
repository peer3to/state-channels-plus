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
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { TestPeer } from "../types";

export class InlineP2pInternalsHandle implements P2pInternalsInterface {
    constructor(private readonly peer: TestPeer) {}

    async openConnections(): Promise<TransportSummary[]> {
        const conns = this.peer.stateManager.p2pManager
            .openConnections as unknown as Array<{
            connectionId?: string;
            peerAddress?: string;
            kind?: string;
        }>;
        return conns.map((t) => ({
            connectionId: t.connectionId ?? "",
            peerAddress: (t.peerAddress ?? "0x") as Address,
            kind: t.kind ?? "unknown"
        }));
    }

    async getProfileByEvmAddress(
        addr: Address
    ): Promise<ProfileSummary | undefined> {
        const pm = this.peer.stateManager.p2pManager as unknown as {
            profileManager?: {
                getProfileByEvmAddress?: (a: Address) =>
                    | {
                          evmAddress?: string;
                          transport?: { connectionId?: string };
                      }
                    | undefined;
            };
        };
        const profile = pm.profileManager?.getProfileByEvmAddress?.(addr);
        if (!profile) return undefined;
        return {
            evmAddress: (profile.evmAddress ?? addr) as Address,
            connectionId: profile.transport?.connectionId ?? ""
        };
    }

    async getProfileByConnectionId(
        connectionId: string
    ): Promise<ProfileSummary | undefined> {
        const pm = this.peer.stateManager.p2pManager as unknown as {
            openConnections: Array<{ connectionId?: string }>;
            profileManager?: {
                getProfileByTransport?: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        };
        for (const t of pm.openConnections) {
            if (t.connectionId === connectionId) {
                const profile = pm.profileManager?.getProfileByTransport?.(t);
                if (!profile) return undefined;
                return {
                    evmAddress: (profile.evmAddress ?? "0x") as Address,
                    connectionId
                };
            }
        }
        return undefined;
    }

    async connectionCount(): Promise<number> {
        return this.peer.stateManager.p2pManager.openConnections.length;
    }

    async isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        const profile =
            this.peer.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                otherAddr
            );
        return profile?.getIsHandshakeCompleted() ?? false;
    }

    async self(): Promise<Address> {
        return this.peer.address as Address;
    }

    async didPeerAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return (await this.runLocalRpcOp(
            "isForkDisputedService",
            "didPeerAcknowledgeDisputedFork",
            [peerAddress, forkId]
        )) as boolean;
    }

    async didIAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return (await this.runLocalRpcOp(
            "isForkDisputedService",
            "didIAcknowledgeDisputedFork",
            [peerAddress, forkId]
        )) as boolean;
    }

    async requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        return (await this.runLocalRpcOp(
            "isForkDisputedService",
            "requestDisputeAcknowledgment",
            [channelId, forkId]
        )) as boolean;
    }

    async respondToDisputeAcknowledgment(
        peerAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        await this.runLocalRpcOp(
            "isForkDisputedService",
            "respondToDisputeAcknowledgment",
            [peerAddress, channelId, forkId]
        );
    }

    async onDisputeAcknowledgmentRequest(
        fromAddr: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        await this.callServiceWithTransport(
            "isForkDisputedService",
            "onDisputeAcknowledgmentRequest",
            fromAddr,
            [channelId, forkId]
        );
    }

    async onInitHandshakeRequest(
        fromAddr: Address,
        hash: Hash,
        time: Timestamp
    ): Promise<void> {
        await this.callServiceWithTransport(
            "initHandshakeService",
            "onInitHandshakeRequest",
            fromAddr,
            [hash, time]
        );
    }

    async onInitHandshakeResponse(
        fromAddr: Address,
        signature: Signature,
        time: Timestamp,
        preferred: TransportType
    ): Promise<void> {
        await this.callServiceWithTransport(
            "initHandshakeService",
            "onInitHandshakeResponse",
            fromAddr,
            [signature, time, preferred]
        );
    }

    async initHandshakeTo(toAddr: Address): Promise<void> {
        await this.callServiceMethodWithTransport(
            "initHandshakeService",
            "initHandshake",
            toAddr,
            []
        );
    }

    private async callServiceMethodWithTransport(
        serviceName: string,
        methodName: string,
        otherAddr: Address,
        args: unknown[]
    ): Promise<unknown> {
        const pmAny = this.peer.stateManager.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
            localRpc: Record<string, unknown>;
        };
        const resolvedTransport = this.resolveTransport(pmAny, otherAddr);
        if (!resolvedTransport)
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: no transport to ${otherAddr}`
            );
        const svc = pmAny.localRpc[serviceName] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc)
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: missing service '${serviceName}'`
            );
        const fn = svc[methodName];
        if (typeof fn !== "function")
            throw new Error(
                `InlinePeer.callServiceMethodWithTransport: '${serviceName}.${methodName}' not a function`
            );
        return await (fn as (...a: unknown[]) => unknown).apply(svc, [
            resolvedTransport,
            ...args
        ]);
    }

    private async callServiceWithTransport(
        serviceName: string,
        methodName: string,
        otherAddr: Address,
        args: unknown[]
    ): Promise<unknown> {
        const pmAny = this.peer.stateManager.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
            localRpc: Record<string, unknown>;
        };
        const resolvedTransport = this.resolveTransport(pmAny, otherAddr);
        if (!resolvedTransport)
            throw new Error(
                `InlinePeer.callServiceWithTransport: no transport to ${otherAddr}`
            );
        const svc = pmAny.localRpc[serviceName] as
            | {
                  createRPCMethods: (
                      t: unknown
                  ) => Record<string, (...a: unknown[]) => unknown>;
              }
            | undefined;
        if (!svc)
            throw new Error(
                `InlinePeer.callServiceWithTransport: missing service '${serviceName}'`
            );
        const methods = svc.createRPCMethods(resolvedTransport);
        const fn = methods[methodName];
        if (typeof fn !== "function")
            throw new Error(
                `InlinePeer.callServiceWithTransport: '${serviceName}.${methodName}' not a function`
            );
        return await (fn as (...a: unknown[]) => unknown).apply(methods, args);
    }

    async getPreferredTransportType(): Promise<number> {
        return (
            this.peer.stateManager.p2pManager as unknown as {
                preferredTransport: number;
            }
        ).preferredTransport;
    }

    async getInitChallenge(
        otherAddr: Address
    ): Promise<{ randomChallengeHash: string; initTime: number } | undefined> {
        const t = this.resolveTransportByAddr(otherAddr);
        if (!t) return undefined;
        const svc = (
            this.peer.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc["initHandshakeService"] as
            | {
                  getChallenge: (
                      t: unknown
                  ) =>
                      | { randomChallengeHash: string; initTime: number }
                      | undefined;
              }
            | undefined;
        const c = svc?.getChallenge(t);
        if (!c) return undefined;
        return {
            randomChallengeHash: c.randomChallengeHash,
            initTime: c.initTime
        };
    }

    async clearInitChallenge(otherAddr: Address): Promise<void> {
        const t = this.resolveTransportByAddr(otherAddr);
        if (!t) return;
        const svc = (
            this.peer.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc["initHandshakeService"] as
            | { mapTransportToChallenge: Map<unknown, unknown> }
            | undefined;
        svc?.mapTransportToChallenge.delete(t);
    }

    async getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        const t = this.resolveTransportByAddr(otherAddr) as
            | { isClosed?: boolean }
            | undefined;
        if (!t) return { present: false };
        return { present: true, isClosed: t.isClosed };
    }

    async blockForkIsDisputed(
        block: BlockConfirmationStruct,
        peerAddress: string
    ): Promise<void> {
        const Block = (await import("@/models")).Block;
        const reconstructed = Block.fromBlockConfirmation(block);
        await this.peer.stateManager.blockValidationStrategy.blockForkIsDisputed(
            reconstructed as never,
            peerAddress
        );
    }

    private resolveTransportByAddr(addr: Address): unknown {
        const pmAny = this.peer.stateManager.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        };
        return this.resolveTransport(pmAny, addr);
    }

    private resolveTransport(
        pmAny: {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        },
        addr: Address
    ): unknown {
        const target = String(addr).toLowerCase();
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target)
                return t;
        }
        return undefined;
    }

    private async runLocalRpcOp(
        svcName: string,
        opName: string,
        opArgs: unknown
    ): Promise<unknown> {
        const localRpc = (
            this.peer.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc;
        const svc = localRpc[svcName] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc) throw new Error(`${svcName} not present on localRpc`);
        const fn = svc[opName];
        if (typeof fn !== "function")
            throw new Error(`${svcName}.${opName} not a function`);
        const bound = fn.bind(svc);
        if (Array.isArray(opArgs)) return await bound(...opArgs);
        return await bound(opArgs);
    }
}
