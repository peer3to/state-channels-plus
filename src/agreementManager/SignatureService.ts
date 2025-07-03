import { AddressLike, SignatureLike } from "ethers";

import * as SetUtils from "@/utils/set";
import { Agreement, AgreementFork } from "./types";

export default class SignatureService {
    static getParticipantSignature(
        agreement: Agreement,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const block = agreement.block;
        for (const sig of agreement.blockSignatures) {
            if (block.getSignerAddress(sig) === participant) {
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
        const signerSet = agreement.block.getSignersSet(
            agreement.blockSignatures
        );
        return SetUtils.excludeFromArray(fork.addressesInThreshold, signerSet);
    }
}
