import type { ChecksumAddress } from "@/types/types";

export enum TransportType {
    HOLEPUNCH,
    WEBRTC,
    LOOPBACK
}

/** One active peer connection: the peer and its transport. */
export type OpenConnection = {
    peerAddress: ChecksumAddress;
    transportType: TransportType;
};
