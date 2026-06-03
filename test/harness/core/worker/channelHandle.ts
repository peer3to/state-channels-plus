import type { Address } from "@/types/types";
import type { Status } from "@/types";
import type { ChannelInterface } from "../interfaces/ChannelInterface";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerChannelHandle implements ChannelInterface {
    constructor(private readonly rpc: PeerCaller) {}

    queryStatus(): Promise<Status> {
        return this.rpc.call(ROUTES.query.status, {}) as Promise<Status>;
    }

    queryNextToWrite(): Promise<Address> {
        return this.rpc.call(ROUTES.query.nextToWrite, {}) as Promise<Address>;
    }

    queryIsMyTurn(): Promise<boolean> {
        return this.rpc.call(ROUTES.query.isMyTurn, {}) as Promise<boolean>;
    }

    queryParticipants(): Promise<Address[]> {
        return this.rpc.call(ROUTES.query.participants, {}) as Promise<
            Address[]
        >;
    }

    isBlacklisted(addr: Address): Promise<boolean> {
        return this.rpc.call(ROUTES.p2p.isBlacklisted, {
            addr
        }) as Promise<boolean>;
    }
}
