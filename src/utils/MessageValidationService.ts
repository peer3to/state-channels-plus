import Clock from "@/Clock";
import Rpc, { createRpcSigningHashFromRpc } from "@/rpc/Rpc";
import { Address } from "@/types/types";
import { ethers } from "ethers";

/**
 * Message Validation Service
 * Handles message validation: signature verification and timestamp validation
 */
export class MessageValidationService {
    private readonly agreementTime: number; // in seconds

    constructor(agreementTime: number) {
        this.agreementTime = agreementTime;
    }

    /**
     * Validate timestamp is within acceptable range
     * Messages are valid if timestamp is within ±agreementTime of current time
     */
    isAcceptableTimestamp(timestamp: number): boolean {
        const now = Clock.getTimeInSeconds();
        const timeDiff = Math.abs(now - timestamp);
        return timeDiff <= this.agreementTime;
    }

    isTimetampFradulent(timestamp: number): boolean {
        const now = Clock.getTimeInSeconds();
        const timeDiff = Math.abs(now - timestamp);
        return !(timeDiff <= this.agreementTime * 2);
    }

    /**
     * Extract signer address from RPC message signature
     */
    async recoverAddressFromRpc(rpc: Rpc): Promise<Address | null> {
        try {
            const signingHash = createRpcSigningHashFromRpc(rpc);

            const recoveredAddress = await ethers.verifyMessage(
                ethers.getBytes(signingHash),
                rpc.signature
            );
            return recoveredAddress;
        } catch (error) {
            return null;
        }
    }
}
