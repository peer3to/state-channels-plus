import type { PeerHandler } from "../../rpc/rpc-server";
import type { PeerCaller } from "../../rpc/rpc-client";
import type StateManager from "@/stateManager";
import { ROUTES } from "../routeNames";

export class TamperRoutes {
    private stateManager?: StateManager;
    private tamperRestore: (() => void) | undefined;

    constructor(
        server: PeerHandler,
        private readonly rpcClient: PeerCaller,
        private readonly peerIndex: number
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
        server.register(ROUTES.byzantine.installDisputeTamperHook, async () => {
            this.tamperRestore?.();
            const dm = this.sm.disputeManager;
            const original = dm.constructDispute.bind(dm);
            dm.constructDispute = async (forkId) => {
                const result = await original(forkId);
                const reply = (await this.rpcClient.call(
                    "harness.tamperDispute",
                    {
                        peerIndex: this.peerIndex,
                        dispute: result.dispute,
                        disputeConfirmation: result.disputeConfirmation,
                        auditingData: result.auditingData
                    }
                )) as typeof result;
                return { ...result, ...reply };
            };
            this.tamperRestore = () => {
                dm.constructDispute = original;
                this.tamperRestore = undefined;
            };
            return {};
        });

        server.register(
            ROUTES.byzantine.uninstallDisputeTamperHook,
            async () => {
                this.tamperRestore?.();
                return {};
            }
        );
    }
}
