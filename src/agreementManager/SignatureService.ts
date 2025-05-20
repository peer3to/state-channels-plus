import { AddressLike, BytesLike, SignatureLike } from "ethers";

import * as SetUtils from "@/utils/set";
import { EvmUtils, BlockUtils } from "@/utils";
import { Agreement, AgreementFork } from "./types";

export default class SignatureService {
    static getSignerAddresses(agreement: Agreement): Set<string> {
        return new Set(agreement.addressesInThreshold as string[]);
    }

    static getParticipantSignature(
        agreement: Agreement,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        for (const sig of agreement.blockConfirmation.signatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(
                    EvmUtils.decodeBlock(
                        agreement.blockConfirmation.signedBlock.encodedBlock
                    ),
                    sig as SignatureLike
                ) === participant
            ) {
                return { didSign: true, signature: sig as SignatureLike };
            }
        }
        return { didSign: false, signature: undefined };
    }

    static doesSignatureExist(
        agreement: Agreement,
        target: SignatureLike
    ): boolean {
        return agreement.blockConfirmation.signatures.includes(
            target as BytesLike
        );
    }

    static getParticipantsWhoDidntSign(agreement: Agreement): AddressLike[] {
        const signerSet = this.getSignerAddresses(agreement);
        return SetUtils.excludeFromArray(
            agreement.addressesInThreshold,
            signerSet
        );
    }
}
