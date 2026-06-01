import type { PeerHandler } from "../../rpc/rpc-server";
import type { P2pInstance } from "@/evm";
import type { AStateMachine } from "@typechain-types";
import { ROUTES } from "../routeNames";

export type MathContract = {
    add(value: number | bigint): Promise<unknown>;
    sub(value: number | bigint): Promise<unknown>;
    set(value: number | bigint): Promise<unknown>;
    leaveChannel(): Promise<unknown>;
};

export class MathRoutes {
    private p2pInstance?: P2pInstance<AStateMachine>;

    constructor(server: PeerHandler) {
        this.register(server);
    }

    setP2pInstance(p2pInstance: P2pInstance<AStateMachine>): void {
        this.p2pInstance = p2pInstance;
    }

    private get contract(): MathContract {
        if (!this.p2pInstance)
            throw new Error(
                "p2pInstance not initialized: p2pSetup has not completed"
            );
        return this.p2pInstance.p2pContractInstance as unknown as MathContract;
    }

    private register(server: PeerHandler): void {
        server.register(ROUTES.math.add, async (req) => {
            const { value = 1 } = (req ?? {}) as { value?: number | bigint };
            return await this.contract.add(value);
        });
        server.register(ROUTES.math.sub, async (req) => {
            const { value = 1 } = (req ?? {}) as { value?: number | bigint };
            return await this.contract.sub(value);
        });
        server.register(ROUTES.math.set, async (req) => {
            const { value } = (req ?? {}) as { value: number | bigint };
            return await this.contract.set(value);
        });
        server.register(ROUTES.math.leaveChannel, async () => {
            return await this.contract.leaveChannel();
        });
    }
}
