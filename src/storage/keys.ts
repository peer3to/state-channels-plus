import type { BlockHeight, ForkId } from "@/types/types";

export type CoordinateKey = string;

export function coordinateKey(
    forkId: ForkId,
    height: BlockHeight
): CoordinateKey {
    return `${forkId}:${height}`;
}
