import type { PeerHandler } from "../../rpc/rpc-server";
import type { PeerCaller } from "../../rpc/rpc-client";
import type StateManager from "@/stateManager";
import { ROUTES } from "../routeNames";
import { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export class NetworkRoutes {
    private stateManager?: StateManager;
    private disconnectFilterRestore?: () => void;

    constructor(
        server: PeerHandler,
        private readonly rpcClient: PeerCaller
    ) {
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

    private register(server: PeerHandler): void {
        server.register(ROUTES.network.disconnectAll, async () => {
            const pm = this.sm.p2pManager;
            const disconnectConnection = pm.disconnectConnection.bind(pm) as (
                conn: unknown
            ) => void;
            for (const conn of [...pm.openConnections]) {
                disconnectConnection(conn);
            }
            return {};
        });

        server.register(
            ROUTES.network.tryOpenConnectionToChannel,
            async ({ channelId }: { channelId: string }) => {
                await this.sm.p2pManager.tryOpenConnectionToChannel(channelId);
                return {};
            }
        );

        server.register(
            ROUTES.lifecycle.joinChannel,
            async ({
                confirmation
            }: {
                confirmation: JoinChannelConfirmationStruct;
            }) => {
                await this.sm.joinChannel(confirmation);
                return {};
            }
        );

        server.register(
            ROUTES.network.installDisconnectFilter,
            async ({ callbackId }: { callbackId: string }) => {
                const pm = this.sm.p2pManager;
                const original =
                    pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
                this.disconnectFilterRestore?.();

                const rpcClient = this.rpcClient;
                pm.disconnectAndBlacklistPeerByEvmAddress = async (
                    addr: string
                ) => {
                    const allow = (await rpcClient.call(
                        "harness.invokeFilterCallback",
                        { id: callbackId, message: addr }
                    )) as boolean;
                    if (!allow) return;
                    return original(addr);
                };
                this.disconnectFilterRestore = () => {
                    pm.disconnectAndBlacklistPeerByEvmAddress = original;
                    this.disconnectFilterRestore = undefined;
                };
                return { id: "disconnectFilter" };
            }
        );

        server.register(ROUTES.network.restoreDisconnectFilter, async () => {
            this.disconnectFilterRestore?.();
            return {};
        });
    }
}
