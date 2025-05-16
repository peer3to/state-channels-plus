import { BytesLike } from "ethers";
import {
    SignedBlockStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { ExecutionFlags } from "@/types";
import { ARpcService, MainRpcService } from "@/rpc";
import { retry } from "@/utils/retry";

class StateTransitionService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    public async onSignedBlock(signedBlock: SignedBlockStruct) {
        //TODO! - require seccusfull init handshake (also on other methods)
        let flag =
            await this.mainRpcService.p2pManager.stateManager.onSignedBlock(
                signedBlock
            );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.mainRpcService.rpcProxy.onSignedBlock(signedBlock).broadcast(); //TODO? - broadcast dispute so others can learn about it
    }

    public async onBlockConfirmation(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ) {
        let flag =
            await this.mainRpcService.p2pManager.stateManager.onBlockConfirmation(
                originalSignedBlock,
                confirmationSignature
            );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.mainRpcService.rpcProxy
                .onBlockConfirmation(originalSignedBlock, confirmationSignature)
                .broadcast();
    }

    public async onDisputeConfirmation(signedDispute: SignedDisputeStruct) {
        const flag =
            this.mainRpcService.p2pManager.stateManager.onDisputeConfirmation(
                signedDispute
            );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.NOT_READY) {
            // Retry once after agreement time
            const agreementTime =
                this.mainRpcService.p2pManager.stateManager.timeConfig
                    .agreementTime;
            const retryConfig = {
                maxRetries: 1,
                delayMs: agreementTime * 1000,
                onRetry: (attempt: number, error: any) => {
                    console.log(
                        `Retrying dispute confirmation (attempt ${attempt}): ${error.message}`
                    );
                }
            };
            try {
                await retry(async () => {
                    const retryFlag =
                        this.mainRpcService.p2pManager.stateManager.onDisputeConfirmation(
                            signedDispute
                        );
                    if (retryFlag !== ExecutionFlags.SUCCESS) {
                        throw new Error(
                            `Dispute confirmation still not ready after retry: ${retryFlag}`
                        );
                    }
                    return retryFlag;
                }, retryConfig);
            } catch (error) {
                console.error("Failed to confirm dispute after retry:", error);
                return;
            }
        }
        // re-broadcast
        if (flag == ExecutionFlags.SUCCESS)
            this.mainRpcService.rpcProxy
                .onDisputeConfirmation(signedDispute)
                .broadcast();
    }
}

export default StateTransitionService;
