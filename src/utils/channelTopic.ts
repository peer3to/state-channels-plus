import { Buffer } from "buffer";

/**
 * The 32-byte swarm topic a channel rendezvouses on.
 *
 * One owner: joining a channel's topic and leaving it again have to agree
 * byte-for-byte, and they previously derived it independently at three call
 * sites. A leave that derives a different topic silently does nothing.
 */
export function deriveChannelTopic(channelId: string): Buffer {
    return Buffer.alloc(32).fill(channelId);
}
