import type { Address } from "@/types/types";
import type { Status } from "@/types";
import type { ChannelInterface } from "../interfaces/ChannelInterface";
import type { TestPeer } from "../types";

export class InlineChannelHandle implements ChannelInterface {
    constructor(private readonly peer: TestPeer) {}

    async queryStatus(): Promise<Status> {
        return this.peer.stateManager.getStatus();
    }

    async queryNextToWrite(): Promise<Address> {
        return this.peer.stateManager.diamondStateMachine.getNextToWrite();
    }

    async queryIsMyTurn(): Promise<boolean> {
        return this.peer.stateManager.isMyTurn();
    }

    async queryParticipants(): Promise<Address[]> {
        return this.peer.stateManager.diamondStateMachine.getParticipants();
    }

    async isBlacklisted(addr: Address): Promise<boolean> {
        return this.peer.stateManager.p2pManager.isBlacklisted(addr);
    }
}
