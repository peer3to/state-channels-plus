import { ethers } from "ethers";
import { ForkId } from "@/types/types";

const NULL = "0x00";

export function isChannelOpen(forkId: ForkId): boolean {
    return forkId !== ethers.ZeroHash && forkId !== NULL;
}
