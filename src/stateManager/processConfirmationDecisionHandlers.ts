import { ExecutionFlags } from "@/types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { SignatureLike } from "ethers";

export interface ConfirmationDecisionContext {
    isDisposed: boolean;
    tryConfirmFromQueue(): Promise<void>;
    queueConfirmation(item: {
        originalSignedBlock: SignedBlockStruct;
        confirmationSignature: SignatureLike;
    }): void;
}

type ConfirmationDecisionHandler = (
    originalSignedBlock: SignedBlockStruct,
    confirmationSignature: SignatureLike,
    ctx: ConfirmationDecisionContext
) => Promise<void>;

export const confirmationDecisionHandlers: Record<
    ExecutionFlags,
    ConfirmationDecisionHandler
> = {
    [ExecutionFlags.SUCCESS]: async (
        _originalSignedBlock,
        _confirmationSignature,
        ctx
    ) => {
        setTimeout(async () => {
            if (ctx.isDisposed) return;
            ctx.tryConfirmFromQueue();
        }, 0);
    },

    // If not ready, queue the confirmation
    [ExecutionFlags.NOT_READY]: async (
        originalSignedBlock,
        confirmationSignature,
        ctx
    ) => {
        ctx.queueConfirmation({
            originalSignedBlock,
            confirmationSignature
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

export async function processConfirmationDecision(
    originalSignedBlock: SignedBlockStruct,
    confirmationSignature: SignatureLike,
    executionFlag: ExecutionFlags,
    ctx: ConfirmationDecisionContext
): Promise<void> {
    const handler = confirmationDecisionHandlers[executionFlag];
    if (!handler) {
        throw new Error(
            `processConfirmationDecision - Internal Error - no handler for flag: ${executionFlag}`
        );
    }
    return handler(originalSignedBlock, confirmationSignature, ctx);
}
