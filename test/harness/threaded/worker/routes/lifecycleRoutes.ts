import type { PeerHandler } from "../../rpc/PeerHandler";
import type StateManager from "@/stateManager";
import { ChannelId, Status } from "@/types";
import { ROUTES } from "../routeNames";

export class LifecycleRoutes {
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

    private register(server: PeerHandler): void {
        server.register(ROUTES.lifecycle.dispose, async () => ({}));

        server.register(
            ROUTES.lifecycle.connectToChannel,
            async ({ channelId }: { channelId: ChannelId }) => {
                if (!channelId)
                    throw new Error(
                        "lifecycle.connectToChannel: missing 'channelId'"
                    );

                await this.sm.p2pManager.p2pSigner.connectToChannel(channelId);

                // Retro-sync connections whose handshakes completed before channelId was set.
                if (this.sm.getStatus() !== Status.OPENED) return {};
                const cid = this.sm.getChannelId();
                for (const conn of this.sm.p2pManager.openConnections) {
                    if (!conn.peerAddress) continue;
                    try {
                        const ok =
                            await this.sm.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                                cid,
                                conn.peerAddress
                            );
                        if (ok)
                            this.sm.p2pManager.localRpc.spectateService.sync(
                                conn.peerAddress,
                                cid
                            );
                    } catch {
                        continue;
                    }
                }
                return {};
            }
        );
    }
}
