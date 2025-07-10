import { ExecutionFlags } from "@/types";
import { Signature, Bytes } from "@/types/types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import Storage from "@/storage";

export class ConfirmationDecisionProcessor {
    constructor(
        private storage: Storage,
        private getIsDisposed: () => boolean,
        private tryConfirmFromQueue: () => Promise<void>
    ) {}

    async process(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: Signature,
        executionFlag: ExecutionFlags
    ): Promise<void> {
        const handler = this.confirmationDecisionHandlers[executionFlag];
        if (!handler) {
            throw new Error(
                `processConfirmationDecision - Internal Error - no handler for flag: ${executionFlag}`
            );
        }
        return handler(originalSignedBlock, confirmationSignature);
    }

    private confirmationDecisionHandlers: Record<
        ExecutionFlags,
        (
            originalSignedBlock: SignedBlockStruct,
            confirmationSignature: Signature
        ) => Promise<void>
    > = {
        [ExecutionFlags.SUCCESS]: async (
            _originalSignedBlock,
            _confirmationSignature
        ) => {
            setTimeout(async () => {
                if (this.getIsDisposed()) return;
                this.tryConfirmFromQueue();
            }, 0);
        },

        // If not ready, queue the confirmation
        [ExecutionFlags.NOT_READY]: async (
            originalSignedBlock,
            confirmationSignature
        ) => {
            this.storage.queues.queueConfirmation({
                signedBlock: originalSignedBlock,
                signatures: [confirmationSignature as Bytes]
            });
        },

        // If duplicate, do nothing
        [ExecutionFlags.DUPLICATE]: async () => {},

        // TODO! - signal p2pManager (response)
        [ExecutionFlags.DISCONNECT]: async () => {},

        // Nothing - done on the onSignedBlock level
        [ExecutionFlags.DISPUTE]: async () => {},

        // Nothing - done on the onSignedBlock level
        [ExecutionFlags.TIMESTAMP_IN_FUTURE]: async () => {},

        // Nothing - done on the onSignedBlock level
        [ExecutionFlags.NOT_ENOUGH_TIME]: async () => {},

        // TODO - think about this - should this be a dispute or just ignore?
        [ExecutionFlags.PAST_FORK]: async () => {}
    };
}
