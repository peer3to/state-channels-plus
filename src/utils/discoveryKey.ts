import { ethers } from "ethers";

/** Uses the channel ID bytes directly as its 32-byte discovery key. */
export function channelIdToDiscoveryKey(channelId: string): string {
    if (!ethers.isHexString(channelId, 32)) {
        throw new Error("Channel ID must be exactly 32 bytes");
    }
    return ethers.hexlify(channelId);
}
