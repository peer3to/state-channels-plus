import Clock from "@/Clock";
import { ethers } from "ethers";

/**
 * Message Validation Service
 * Handles message validation: signature verification and timestamp validation
 */
export class MessageValidationService {
    private readonly agreementTime: number; // in milliseconds

    constructor(agreementTimeMs: number) {
        this.agreementTime = agreementTimeMs;
    }

    /**
     * Validate timestamp is within acceptable range
     * Messages are valid if timestamp is within ±agreementTime of current time
     */
    isTimestampValid(timestamp: number): boolean {
        const now = Clock.getTimeInSeconds();
        const timeDiff = Math.abs(now - timestamp);
        return timeDiff <= Math.floor(this.agreementTime / 1000); // agreementTime is in ms
    }

    /**
     * Extract signer address from RPC message signature
     */
    async extractSignerFromRpc(rpc: any): Promise<string | null> {
        try {
            const messageContent = JSON.stringify({
                service: rpc.service,
                method: rpc.method,
                params: rpc.params,
                timestamp: rpc.timestamp
            });

            const recoveredAddress = await ethers.verifyMessage(
                messageContent,
                rpc.signature
            );
            return recoveredAddress.toLowerCase();
        } catch (error) {
            return null;
        }
    }
}
