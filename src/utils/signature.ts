import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BytesLike, SignatureLike, ethers } from "ethers";
import { channelIdOf, participantOf } from "@/utils/BlockUtils";

/**
 * Verifies
 *  ▸ channel-id matches the local channel
 *  ▸ ECDSA signature really comes from `block.transaction.header.participant`
 */
export function isSignedBlockAuthentic(
    signed: SignedBlockStruct,
    block: BlockStruct,
    expectedChannelId: BytesLike
): boolean {
    if (channelIdOf(block) !== expectedChannelId) return false;

    const h = ethers.keccak256(signed.encodedBlock);
    const signer = ethers.verifyMessage(
        ethers.getBytes(h),
        signed.signature as SignatureLike
    );

    return signer === participantOf(block);
}
