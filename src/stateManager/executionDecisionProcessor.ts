import { ExecutionFlags, AgreementFlag } from "@/types";

import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { inject, ServiceNames } from "@/container";

export class ExecutionDecisionProcessor {
    constructor(private onSuccessCb: () => Promise<void>) {}

    private get storage() {
        return inject(ServiceNames.STORAGE);
    }
    private get p2pManager() {
        return inject(ServiceNames.P2P_MANAGER);
    }
    private get disputeHandler() {
        return inject(ServiceNames.DISPUTE_HANDLER);
    }

    async process(
        signedBlock: SignedBlockStruct,
        executionFlag: ExecutionFlags,
        agreementFlag?: AgreementFlag
    ): Promise<void> {
        const handler = this.executionDecisionHandlers[executionFlag];
        if (!handler) {
            throw new Error(
                `StateManager - processDecision - Unknown ExecutionFlag: ${executionFlag}`
            );
        }
        return handler(signedBlock, agreementFlag);
    }

    private executionDecisionHandlers: Record<
        ExecutionFlags,
        (
            signedBlock: SignedBlockStruct,
            agreementFlag?: AgreementFlag
        ) => Promise<void>
    > = {
        [ExecutionFlags.SUCCESS]: async (signedBlock) => {
            await this.p2pManager.p2pSigner.confirmBlock(signedBlock);
            await this.onSuccessCb();
        },

        [ExecutionFlags.NOT_READY]: async (signedBlock) => {
            this.storage.queues.queueBlock(signedBlock);
        },

        [ExecutionFlags.DUPLICATE]: async () => {},

        // TODO! - signal p2pManager (response)
        [ExecutionFlags.DISCONNECT]: async () => {},

        [ExecutionFlags.DISPUTE]: async (signedBlock, agreementFlag) => {
            if (agreementFlag == null) {
                throw new Error(
                    `ExecutionFlags.DISPUTE triggered but no agreementFlag provided`
                );
            }

            const disputeHandlerFn = this.disputeHandlers[agreementFlag];
            if (!disputeHandlerFn) {
                throw new Error(
                    `StateManager - processDecision - AgreementFlag ${agreementFlag} - Internal Error`
                );
            }
            await disputeHandlerFn(signedBlock);
        },

        // TODO - try dispute?
        [ExecutionFlags.TIMESTAMP_IN_FUTURE]: async () => {},

        // nothing - success path of previous block already initiated tryTimeout for this block
        [ExecutionFlags.NOT_ENOUGH_TIME]: async () => {},

        // TODO - think about this - should this be a dispute or just ignore?
        [ExecutionFlags.PAST_FORK]: async () => {}
    };

    private disputeHandlers: Partial<
        Record<AgreementFlag, (signedBlock: SignedBlockStruct) => Promise<void>>
    > = {
        [AgreementFlag.DOUBLE_SIGN]: async (signedBlock) => {
            this.disputeHandler.disputeDoubleSign([signedBlock]);
        },
        [AgreementFlag.INCORRECT_DATA]: async (signedBlock) => {
            this.disputeHandler.disputeIncorrectData(signedBlock);
        }
    };
}
