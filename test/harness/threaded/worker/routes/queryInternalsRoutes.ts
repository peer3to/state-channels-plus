import type { PeerHandler } from "../../rpc/PeerHandler";
import type StateManager from "@/stateManager";
import type { ATransport } from "@/transport";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ROUTES } from "../routeNames";
import { Block } from "@/models";

export class QueryInternalsRoutes {
    private stateManager?: StateManager;

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

    private resolveTransport(otherAddr: string): ATransport | undefined {
        const target = String(otherAddr).toLowerCase();
        for (const t of this.sm.p2pManager.openConnections) {
            const profile =
                this.sm.p2pManager.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target)
                return t;
        }
        return undefined;
    }

    private register(server: PeerHandler): void {
        server.register(ROUTES.queryInternals.openConnections, async () => {
            type TransportRuntime = {
                connectionId?: string;
                peerAddress?: string;
                kind?: string;
            };
            return (
                this.sm.p2pManager.openConnections as TransportRuntime[]
            ).map((t) => ({
                connectionId: t.connectionId ?? "",
                peerAddress: t.peerAddress ?? "0x",
                kind: t.kind ?? "unknown"
            }));
        });

        server.register(
            ROUTES.queryInternals.getProfileByEvmAddress,
            async ({ addr }: { addr: string }) => {
                if (!addr)
                    throw new Error(
                        "queryInternals.getProfileByEvmAddress: missing 'addr'"
                    );
                const profile =
                    this.sm.p2pManager.profileManager.getProfileByEvmAddress(
                        addr
                    );
                if (!profile) return undefined;
                return {
                    evmAddress: profile.evmAddress ?? addr,
                    connectionId:
                        (
                            profile.transport as unknown as {
                                connectionId?: string;
                            }
                        )?.connectionId ?? ""
                };
            }
        );

        server.register(ROUTES.queryInternals.connectionCount, async () => {
            return this.sm.p2pManager.openConnections.length;
        });

        server.register(
            ROUTES.queryInternals.isHandshakeCompletedWith,
            async ({ otherAddr }: { otherAddr: string }) => {
                const profile =
                    this.sm.p2pManager.profileManager.getProfileByEvmAddress(
                        otherAddr
                    );
                return profile?.getIsHandshakeCompleted() ?? false;
            }
        );

        server.register(
            ROUTES.queryInternals.isForkDisputedService,
            async ({ op, args: opArgs }: { op: string; args: unknown }) => {
                if (!op)
                    throw new Error(
                        "queryInternals.isForkDisputedService: missing 'op'"
                    );
                return this.callLocalRpcOp("isForkDisputedService", op, opArgs);
            }
        );

        server.register(
            ROUTES.queryInternals.callServiceWithTransport,
            async ({
                serviceName,
                methodName,
                otherAddr,
                args: callArgs
            }: {
                serviceName: string;
                methodName: string;
                otherAddr: string;
                args: unknown[];
            }) => {
                if (!serviceName || !methodName || !otherAddr)
                    throw new Error(
                        "queryInternals.callServiceWithTransport: missing required args"
                    );
                const resolvedTransport = this.resolveTransport(otherAddr);
                if (!resolvedTransport)
                    throw new Error(
                        `queryInternals.callServiceWithTransport: no transport to ${otherAddr}`
                    );
                const localRpc = this.sm.p2pManager
                    .localRpc as unknown as Record<string, unknown>;
                const svc = localRpc[serviceName] as
                    | {
                          createRPCMethods: (
                              t: unknown
                          ) => Record<string, (...a: unknown[]) => unknown>;
                      }
                    | undefined;
                if (!svc)
                    throw new Error(
                        `queryInternals.callServiceWithTransport: missing service '${serviceName}'`
                    );
                const methods = svc.createRPCMethods(resolvedTransport);
                const fn = methods[methodName];
                if (typeof fn !== "function")
                    throw new Error(
                        `queryInternals.callServiceWithTransport: '${serviceName}.${methodName}' not a function`
                    );
                return await fn.apply(methods, callArgs ?? []);
            }
        );

        server.register(
            ROUTES.queryInternals.callServiceMethodWithTransport,
            async ({
                serviceName,
                methodName,
                otherAddr,
                args: callArgs
            }: {
                serviceName: string;
                methodName: string;
                otherAddr: string;
                args: unknown[];
            }) => {
                if (!serviceName || !methodName || !otherAddr)
                    throw new Error(
                        "queryInternals.callServiceMethodWithTransport: missing required args"
                    );
                const resolvedTransport = this.resolveTransport(otherAddr);
                if (!resolvedTransport)
                    throw new Error(
                        `queryInternals.callServiceMethodWithTransport: no transport to ${otherAddr}`
                    );
                const localRpc = this.sm.p2pManager
                    .localRpc as unknown as Record<string, unknown>;
                const svc = localRpc[serviceName] as
                    | Record<string, (...a: unknown[]) => unknown>
                    | undefined;
                if (!svc)
                    throw new Error(
                        `queryInternals.callServiceMethodWithTransport: missing service '${serviceName}'`
                    );
                const fn = svc[methodName];
                if (typeof fn !== "function")
                    throw new Error(
                        `queryInternals.callServiceMethodWithTransport: '${serviceName}.${methodName}' not a function`
                    );
                return await fn.apply(svc, [
                    resolvedTransport,
                    ...(callArgs ?? [])
                ]);
            }
        );

        server.register(
            ROUTES.queryInternals.getPreferredTransportType,
            async () => this.sm.p2pManager.preferredTransport
        );

        server.register(
            ROUTES.queryInternals.getInitChallenge,
            async ({ otherAddr }: { otherAddr: string }) => {
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.getInitChallenge: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr);
                if (!t) return undefined;
                const c =
                    this.sm.p2pManager.localRpc.initHandshakeService.getChallenge(
                        t
                    );
                if (!c) return undefined;
                return {
                    randomChallengeHash: c.randomChallengeHash,
                    initTime: c.initTime
                };
            }
        );

        server.register(
            ROUTES.queryInternals.clearInitChallenge,
            async ({ otherAddr }: { otherAddr: string }) => {
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.clearInitChallenge: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr);
                if (!t) return {};
                this.sm.p2pManager.localRpc.initHandshakeService.mapTransportToChallenge.delete(
                    t
                );
                return {};
            }
        );

        server.register(
            ROUTES.queryInternals.getTransportStatus,
            async ({ otherAddr }: { otherAddr: string }) => {
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.getTransportStatus: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr);
                if (!t) return { present: false };
                return { present: true, isClosed: t.isClosed };
            }
        );

        server.register(
            ROUTES.queryInternals.blockForkIsDisputed,
            async ({
                block,
                peerAddress
            }: {
                block: BlockConfirmationStruct;
                peerAddress: string;
            }) => {
                if (!block)
                    throw new Error(
                        "queryInternals.blockForkIsDisputed: missing 'block'"
                    );
                if (!peerAddress)
                    throw new Error(
                        "queryInternals.blockForkIsDisputed: missing 'peerAddress'"
                    );
                const reconstructed = Block.fromBlockConfirmation(block);
                await this.sm.blockValidationStrategy.blockForkIsDisputed(
                    reconstructed,
                    peerAddress
                );
                return {};
            }
        );
    }

    private async callLocalRpcOp(
        svcName: string,
        opName: string,
        opArgs: unknown
    ): Promise<unknown> {
        const localRpc = this.sm.p2pManager.localRpc as unknown as Record<
            string,
            unknown
        >;
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
