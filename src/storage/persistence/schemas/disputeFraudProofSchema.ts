import { ethers } from "ethers";
import { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, Type, hash } from "@/utils";
import { DisputeFraudProofStorage } from "../../DisputeFraudProofStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

/**
 * The outer DisputeFraudProofStruct {proofType, participant, dispute,
 * encodedProof} has no Codec.Type of its own (only the inner dispute struct
 * does), so it's hand-rolled with the same AbiCoder-envelope mechanism
 * fraudProofsSchema uses - never re-implement an on-chain validator in TS.
 */
function encodeDisputeFraudProof(
    disputeFraudProof: DisputeFraudProofStruct
): string {
    const encodedDispute = Codec.encode(
        disputeFraudProof.dispute,
        Type.Dispute
    );
    return persistenceAbiCoder.encode(
        ["uint256", "address", "bytes", "bytes"],
        [
            disputeFraudProof.proofType,
            disputeFraudProof.participant,
            encodedDispute,
            disputeFraudProof.encodedProof
        ]
    );
}

function decodeDisputeFraudProof(encoded: string): DisputeFraudProofStruct {
    const [proofType, participant, encodedDispute, encodedProof] =
        persistenceAbiCoder.decode(
            ["uint256", "address", "bytes", "bytes"],
            encoded
        );
    return {
        proofType,
        participant,
        dispute: Codec.decode(encodedDispute, Type.Dispute),
        encodedProof
    };
}

/**
 * Durability schema for the dispute-fraud-proof store. Keyed and immutable by
 * hash(Codec.encode(dispute, Type.Dispute)) - storeFraudProof never
 * overwrites an existing entry (first-write wins), so the map key alone is a
 * sufficient changeKey fingerprint (recomputed from the dispute, matching how
 * the key was derived at store time).
 */
export function disputeFraudProofSchema(
    raw: DisputeFraudProofStorage
): PersistenceSchema<DisputeFraudProofStruct> {
    return {
        id: "disputeFraudProofs",

        entries: function* () {
            for (const [
                disputeHash,
                disputeFraudProof
            ] of raw.persistableEntries()) {
                yield [disputeHash as string, disputeFraudProof];
            }
        },

        changeKey: (disputeFraudProof) =>
            hash(Codec.encode(disputeFraudProof.dispute, Type.Dispute)),

        encode: encodeDisputeFraudProof,

        decode: decodeDisputeFraudProof,

        replay: (encoded) => {
            raw.storeFraudProof(decodeDisputeFraudProof(encoded));
        }
    };
}
