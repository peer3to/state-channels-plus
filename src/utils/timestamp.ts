import { BlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { forkOf, heightOf, timestampOf } from "@/utils/BlockUtils";
import AgreementManager from "@/AgreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import { BytesLike } from "ethers";
import { ExecutionFlags } from "@/DataTypes";

/* subjective tolerances (BigInt seconds) */
export const TOLERANCE_PAST = 5n;
export const TOLERANCE_FUTURE = 10n;

/** ─────────────────────────────────────────────────────────────
 *  Subjective “too old / too far in the future” check
 */
export function subjectiveTimingFlag(
    blockTs: number,
    nowTs: number
): ExecutionFlags {
    const diff = BigInt(nowTs) - BigInt(blockTs);
    // Check if block is too old
    if (diff > TOLERANCE_PAST) return ExecutionFlags.NOT_ENOUGH_TIME;
    // Check if block is too far in the future
    if (diff < -TOLERANCE_FUTURE) return ExecutionFlags.DISPUTE;
    // ok
    return ExecutionFlags.SUCCESS;
}

/** ─────────────────────────────────────────────────────────────
 *  Objective rule that also consults on-chain timestamps
 */
export async function objectiveTimestampIsValid(
    blk: BlockStruct,
    timeCfg: { p2pTime: number },
    agreementManager: AgreementManager,
    scm: AStateChannelManagerProxy,
    channelId: BytesLike
): Promise<boolean> {
    const ts = timestampOf(blk);
    const forkCnt = forkOf(blk);
    const height = heightOf(blk);

    const latestTxTs = agreementManager.getLatestBlockTimestamp(forkCnt);
    let referenceTs = agreementManager.getLatestTimestamp(forkCnt, height);

    if (ts < latestTxTs) throw new Error("Backwards timestamp");

    if (ts > referenceTs + timeCfg.p2pTime) {
        const chainTs = Number(
            await scm.getChainLatestBlockTimestamp(channelId, forkCnt, height)
        );
        if (chainTs > referenceTs) referenceTs = chainTs;
        if (ts > referenceTs + timeCfg.p2pTime) return false;
    }
    return true;
}
