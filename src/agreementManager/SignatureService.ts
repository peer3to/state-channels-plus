import { AddressLike, SignatureLike } from "ethers";

import * as SetUtils from "@/utils/set";
import { EvmUtils, BlockUtils } from "@/utils";
import { Agreement, AgreementFork } from "./types";

export default class SignatureService {
    static getSignerAddresses(agreement: Agreement): Set<string> {
        return BlockUtils.getSignerAddresses(
            agreement.block,
            agreement.blockSignatures
        );
    }

    static getParticipantSignature(
        agreement: Agreement,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        for (const sig of agreement.blockSignatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(agreement.block, sig) ===
                participant
            ) {
                return { didSign: true, signature: sig };
            }
        }
        return { didSign: false, signature: undefined };
    }

    static doesSignatureExist(
        agreement: Agreement,
        target: SignatureLike
    ): boolean {
        return agreement.blockSignatures.includes(target);
    }

    static getParticipantsWhoDidntSign(
        fork: AgreementFork,
        agreement: Agreement
    ): AddressLike[] {
        const signerSet = this.getSignerAddresses(agreement);
        return SetUtils.excludeFromArray(fork.addressesInThreshold, signerSet);
    }
}
