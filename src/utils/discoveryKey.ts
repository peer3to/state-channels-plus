import { ethers } from "ethers";

/** Uses the channel ID bytes directly as its 32-byte discovery key. */
export function channelIdToDiscoveryKey(channelId: string): string {
    if (!ethers.isHexString(channelId, 32)) {
        throw new Error("Channel ID must be exactly 32 bytes");
    }
    return ethers.hexlify(channelId);
}

/** Uses a separate rendezvous namespace before the selected channel opens. */
export function channelIdToTargetedJoinTopic(channelId: string): string {
    if (!ethers.isHexString(channelId, 32)) {
        throw new Error("Channel ID must be exactly 32 bytes");
    }
    return ethers.solidityPackedKeccak256(
        ["string", "bytes32"],
        ["targeted-channel-join", ethers.hexlify(channelId)]
    );
}
