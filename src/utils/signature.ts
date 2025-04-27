import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { AddressLike, BytesLike, SignatureLike, ethers } from "ethers";
import { channelIdOf, participantOf } from "@/utils/BlockUtils";
import { EvmUtils } from ".";

export function getSignerAddresses(
    block: BlockStruct,
    signatures: SignatureLike[]
): Set<string> {
    return new Set(
        signatures.map((sig) => EvmUtils.retrieveSignerAddressBlock(block, sig))
    );
}

export function getParticipantSignature(
    block: BlockStruct,
    signatures: SignatureLike[],
    participant: AddressLike
): { didSign: boolean; signature: SignatureLike | undefined } {
    for (const sig of signatures) {
        if (EvmUtils.retrieveSignerAddressBlock(block, sig) === participant) {
            return { didSign: true, signature: sig };
        }
    }
    return { didSign: false, signature: undefined };
}
