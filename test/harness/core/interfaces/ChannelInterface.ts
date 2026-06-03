import type { Address } from "@/types/types";
import type { Status } from "@/types";

export interface ChannelInterface {
    // --- reads: membership & turn ---

    queryStatus(): Promise<Status>;

    queryNextToWrite(): Promise<Address>;

    queryIsMyTurn(): Promise<boolean>;

    queryParticipants(): Promise<Address[]>;

    isBlacklisted(addr: Address): Promise<boolean>;
}
