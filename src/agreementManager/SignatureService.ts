import * as SetUtils from "@/utils/set";
import { Agreement, AgreementFork } from "./types";
import { Address, Signature } from "@/types/types";

export default class SignatureService {
    static getParticipantSignature(
        agreement: Agreement,
        participant: Address
    ): { didSign: boolean; signature: Signature | undefined } {
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
        target: Signature
    ): boolean {
        return agreement.blockSignatures.includes(target);
    }

    static getParticipantsWhoDidntSign(
        fork: AgreementFork,
        agreement: Agreement
    ): Address[] {
        const signerSet = agreement.block.getSignersSet(
            agreement.blockSignatures
        );
        return SetUtils.excludeFromArray(fork.addressesInThreshold, signerSet);
    }
}
