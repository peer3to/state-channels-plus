import type { ChannelId } from "@/types/types";

export type ChannelKey = string;

export function channelKey(channelId: ChannelId): ChannelKey {
    return String(channelId).toLowerCase();
}
