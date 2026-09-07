import { requireBytes32 } from "@/utils/bytes32";
import { ethers } from "ethers";

/** Uses the channel ID bytes directly as its 32-byte discovery key. */
export function channelIdToDiscoveryKey(channelId: string): string {
    requireBytes32(channelId, "Channel ID must be exactly 32 bytes");
    return ethers.hexlify(channelId);
}

/** Uses a separate rendezvous namespace before the selected channel opens. */
export function channelIdToTargetedJoinTopic(channelId: string): string {
    requireBytes32(channelId, "Channel ID must be exactly 32 bytes");
    return ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["targeted-channel-join", ethers.hexlify(channelId)]
    );
}
