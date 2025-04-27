import { ExecutionFlags, AgreementFlag } from "@/types";
import AgreementManager from "@/agreementManager/AgreementManager";
import P2PManager from "@/P2PManager";
import DisputeHandler from "@/DisputeHandler";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

export interface DecisionContext {
    p2pManager: P2PManager;
    agreementManager: AgreementManager;
    disputeHandler: DisputeHandler;
    onSuccessCb: () => Promise<void>;
    forkCount: number;
}

const disputeHandlers: Partial<
    Record<
        AgreementFlag,
        (signedBlock: SignedBlockStruct, ctx: DecisionContext) => Promise<void>
    >
> = {
    [AgreementFlag.DOUBLE_SIGN]: async (signedBlock, ctx) => {
        ctx.disputeHandler.disputeDoubleSign([signedBlock]);
    },
    [AgreementFlag.INCORRECT_DATA]: async (signedBlock, ctx) => {
        ctx.disputeHandler.disputeIncorrectData(signedBlock);
    }
};

export const executionDecisionHandlers: Record<
    ExecutionFlags,
    (
        signedBlock: SignedBlockStruct,
        agreementFlag: AgreementFlag | undefined,
        ctx: DecisionContext
    ) => Promise<void>
> = {
    [ExecutionFlags.SUCCESS]: async (signedBlock, _, ctx) => {
        await ctx.p2pManager.p2pSigner.confirmBlock(signedBlock);
        await ctx.onSuccessCb();
    },

    [ExecutionFlags.NOT_READY]: async (signedBlock, _, ctx) =>
        ctx.agreementManager.queueBlock(signedBlock),

    [ExecutionFlags.DUPLICATE]: async () => {},

    // TODO! - signal p2pManager (response)
    [ExecutionFlags.DISCONNECT]: async () => {},

    [ExecutionFlags.DISPUTE]: async (signedBlock, agreementFlag, ctx) => {
        if (agreementFlag == null) {
            throw new Error(
                `ExecutionFlags.DISPUTE triggered but no agreementFlag provided`
            );
        }

        const disputeHandlerFn = disputeHandlers[agreementFlag];
        if (!disputeHandlerFn) {
            throw new Error(
                `StateManager - processDecision - AgreementFlag ${agreementFlag} - Internal Error`
            );
        }
        await disputeHandlerFn(signedBlock, ctx);
    },
    // TODO - try dispute?
    [ExecutionFlags.TIMESTAMP_IN_FUTURE]: async () => {},

    // nothing - success path of previous block already initiated tryTimeout for this block
    [ExecutionFlags.NOT_ENOUGH_TIME]: async () => {},

    // TODO - think about this - should this be a dispute or just ignore?
    [ExecutionFlags.PAST_FORK]: async () => {}
};

export async function processExecutionDecision(
    signedBlock: SignedBlockStruct,
    executionFlag: ExecutionFlags,
    agreementFlag: AgreementFlag | undefined,
    ctx: DecisionContext
): Promise<void> {
    const handler = executionDecisionHandlers[executionFlag];
    if (!handler) {
        throw new Error(
            `StateManager - processDecision - Unknown ExecutionFlag: ${executionFlag}`
        );
    }
    return handler(signedBlock, agreementFlag, ctx);
}
