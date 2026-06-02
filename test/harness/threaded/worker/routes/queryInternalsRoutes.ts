import type { PeerHandler } from "../../rpc/rpc-server";
import type StateManager from "@/stateManager";
import { ROUTES } from "../routeNames";

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

    private resolveTransport(otherAddr: string): unknown {
        const pmAny = this.sm.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        };
        const target = String(otherAddr).toLowerCase();
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
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
            const out: Array<{
                connectionId: string;
                peerAddress: string;
                kind: string;
            }> = [];
            for (const t of this.sm.p2pManager
                .openConnections as unknown as TransportRuntime[]) {
                out.push({
                    connectionId: t.connectionId ?? "",
                    peerAddress: t.peerAddress ?? "0x",
                    kind: t.kind ?? "unknown"
                });
            }
            return out;
        });

        server.register(
            ROUTES.queryInternals.getProfileByEvmAddress,
            async (args) => {
                const { addr } = (args ?? {}) as { addr?: string };
                if (!addr)
                    throw new Error(
                        "queryInternals.getProfileByEvmAddress: missing 'addr'"
                    );
                const profile =
                    this.sm.p2pManager.profileManager?.getProfileByEvmAddress?.(
                        addr
                    ) as
                        | {
                              evmAddress?: string;
                              transport?: { connectionId?: string };
                          }
                        | undefined;
                if (!profile) return undefined;
                return {
                    evmAddress: profile.evmAddress ?? addr,
                    connectionId: profile.transport?.connectionId ?? ""
                };
            }
        );

        server.register(
            ROUTES.queryInternals.getProfileByConnectionId,
            async (args) => {
                const { connectionId } = (args ?? {}) as {
                    connectionId?: string;
                };
                if (!connectionId)
                    throw new Error(
                        "queryInternals.getProfileByConnectionId: missing 'connectionId'"
                    );
                type TransportRuntime = { connectionId?: string };
                for (const t of this.sm.p2pManager
                    .openConnections as unknown as TransportRuntime[]) {
                    if (t.connectionId === connectionId) {
                        const getProfile = this.sm.p2pManager.profileManager
                            ?.getProfileByTransport as unknown as
                            | ((
                                  t: unknown
                              ) => { evmAddress?: string } | undefined)
                            | undefined;
                        const profile = getProfile?.(t) as
                            | { evmAddress?: string }
                            | undefined;
                        if (!profile) return undefined;
                        return {
                            evmAddress: profile.evmAddress ?? "0x",
                            connectionId
                        };
                    }
                }
                return undefined;
            }
        );

        server.register(ROUTES.queryInternals.connectionCount, async () => {
            return this.sm.p2pManager.openConnections.length;
        });

        server.register(
            ROUTES.queryInternals.isHandshakeCompletedWith,
            async (req) => {
                const { otherAddr } = (req ?? {}) as { otherAddr: string };
                const sm = this.sm as unknown as {
                    p2pManager: {
                        profileManager: {
                            getProfileByEvmAddress: (
                                a: string
                            ) =>
                                | { getIsHandshakeCompleted: () => boolean }
                                | undefined;
                        };
                    };
                };
                const profile =
                    sm.p2pManager.profileManager.getProfileByEvmAddress(
                        otherAddr
                    );
                return profile?.getIsHandshakeCompleted() ?? false;
            }
        );

        server.register(ROUTES.queryInternals.self, async () => {
            return (this.sm as unknown as { signerAddress: string })
                .signerAddress;
        });

        server.register(
            ROUTES.queryInternals.isForkDisputedService,
            async (args) => {
                const { op, args: opArgs } = (args ?? {}) as {
                    op?: string;
                    args?: unknown;
                };
                if (!op)
                    throw new Error(
                        "queryInternals.isForkDisputedService: missing 'op'"
                    );
                return this.callLocalRpcOp("isForkDisputedService", op, opArgs);
            }
        );

        server.register(
            ROUTES.queryInternals.callServiceWithTransport,
            async (args) => {
                const {
                    serviceName,
                    methodName,
                    otherAddr,
                    args: callArgs
                } = (args ?? {}) as {
                    serviceName?: string;
                    methodName?: string;
                    otherAddr?: string;
                    args?: unknown[];
                };
                if (!serviceName || !methodName || !otherAddr)
                    throw new Error(
                        "queryInternals.callServiceWithTransport: missing required args"
                    );
                const resolvedTransport = this.resolveTransport(otherAddr);
                if (!resolvedTransport)
                    throw new Error(
                        `queryInternals.callServiceWithTransport: no transport to ${otherAddr}`
                    );
                const pmAny = this.sm.p2pManager as unknown as {
                    localRpc: Record<string, unknown>;
                };
                const svc = pmAny.localRpc[serviceName] as
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
                return await (fn as (...a: unknown[]) => unknown).apply(
                    methods,
                    callArgs ?? []
                );
            }
        );

        server.register(
            ROUTES.queryInternals.callServiceMethodWithTransport,
            async (args) => {
                const {
                    serviceName,
                    methodName,
                    otherAddr,
                    args: callArgs
                } = (args ?? {}) as {
                    serviceName?: string;
                    methodName?: string;
                    otherAddr?: string;
                    args?: unknown[];
                };
                if (!serviceName || !methodName || !otherAddr)
                    throw new Error(
                        "queryInternals.callServiceMethodWithTransport: missing required args"
                    );
                const resolvedTransport = this.resolveTransport(otherAddr);
                if (!resolvedTransport)
                    throw new Error(
                        `queryInternals.callServiceMethodWithTransport: no transport to ${otherAddr}`
                    );
                const pmAny = this.sm.p2pManager as unknown as {
                    localRpc: Record<string, unknown>;
                };
                const svc = pmAny.localRpc[serviceName] as
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
                return await (fn as (...a: unknown[]) => unknown).apply(svc, [
                    resolvedTransport,
                    ...(callArgs ?? [])
                ]);
            }
        );

        server.register(
            ROUTES.queryInternals.getPreferredTransportType,
            async () => {
                return (
                    this.sm.p2pManager as unknown as {
                        preferredTransport: number;
                    }
                ).preferredTransport;
            }
        );

        server.register(
            ROUTES.queryInternals.getInitChallenge,
            async (args) => {
                const { otherAddr } = (args ?? {}) as { otherAddr?: string };
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.getInitChallenge: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr);
                if (!t) return undefined;
                const svc = this.sm.p2pManager.localRpc[
                    "initHandshakeService"
                ] as
                    | {
                          getChallenge: (t: unknown) =>
                              | {
                                    randomChallengeHash: string;
                                    initTime: number;
                                }
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
        );

        server.register(
            ROUTES.queryInternals.clearInitChallenge,
            async (args) => {
                const { otherAddr } = (args ?? {}) as { otherAddr?: string };
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.clearInitChallenge: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr);
                if (!t) return {};
                const svc = this.sm.p2pManager.localRpc[
                    "initHandshakeService"
                ] as unknown as
                    | {
                          mapTransportToChallenge: {
                              delete: (k: unknown) => void;
                          };
                      }
                    | undefined;
                svc?.mapTransportToChallenge.delete(t);
                return {};
            }
        );

        server.register(
            ROUTES.queryInternals.getTransportStatus,
            async (args) => {
                const { otherAddr } = (args ?? {}) as { otherAddr?: string };
                if (!otherAddr)
                    throw new Error(
                        "queryInternals.getTransportStatus: missing otherAddr"
                    );
                const t = this.resolveTransport(otherAddr) as
                    | { isClosed?: boolean }
                    | undefined;
                if (!t) return { present: false };
                return { present: true, isClosed: t.isClosed };
            }
        );

        server.register(
            ROUTES.queryInternals.blockForkIsDisputed,
            async (args) => {
                const { block, peerAddress } = (args ?? {}) as {
                    block?: unknown;
                    peerAddress?: string;
                };
                if (!block)
                    throw new Error(
                        "queryInternals.blockForkIsDisputed: missing 'block'"
                    );
                if (!peerAddress)
                    throw new Error(
                        "queryInternals.blockForkIsDisputed: missing 'peerAddress'"
                    );
                const Block = (await import("@/models")).Block;
                const reconstructed = Block.fromBlockConfirmation(
                    block as Parameters<typeof Block.fromBlockConfirmation>[0]
                );
                await this.sm.blockValidationStrategy.blockForkIsDisputed(
                    reconstructed as Parameters<
                        typeof this.sm.blockValidationStrategy.blockForkIsDisputed
                    >[0],
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
        const svc = (
            this.sm.p2pManager.localRpc as unknown as Record<string, unknown>
        )[svcName] as Record<string, (...a: unknown[]) => unknown> | undefined;
        if (!svc) throw new Error(`${svcName} not present on localRpc`);
        const fn = svc[opName];
        if (typeof fn !== "function")
            throw new Error(`${svcName}.${opName} not a function`);
        const bound = fn.bind(svc);
        if (Array.isArray(opArgs)) return await bound(...opArgs);
        return await bound(opArgs);
    }
}
