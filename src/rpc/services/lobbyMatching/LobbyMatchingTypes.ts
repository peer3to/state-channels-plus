import type { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { Address } from "@/types/types";

export type LobbyRole = "none" | "advertiser" | "selector";
export type RoleEpoch = number;

export type LobbyAvailability = {
    topic: string;
    role: LobbyRole;
    roleEpoch: RoleEpoch;
    available: boolean;
};

export type LobbyPickResult =
    | {
          status: "accepted";
          advertiserChallenge: string;
          roleEpoch: RoleEpoch;
      }
    | { status: "busy" | "rejected" };

export type LobbyCommitResult = {
    status: "acknowledged" | "rejected";
};

export type LobbyMatch = {
    peerAddress: Address;
    attemptNonce: string;
    selectorAddress: Address;
    advertiserAddress: Address;
    selectorChallenge: string;
    advertiserChallenge: string;
};

export type LobbyMatchingServiceOptions = {
    roleDurationMinMs?: number;
    roleDurationMaxMs?: number;
    shouldMatchPeer?: (peerAddress: Address) => boolean;
};

export type LobbyJoinOptions = {
    balance?: BalanceStruct;
    /** Omit or pass null to keep matching until a match or explicit leave. */
    matchTimeoutMs?: number | null;
};

export type LobbyJoinResult = {
    channelId: string;
    peerAddress: string;
};
