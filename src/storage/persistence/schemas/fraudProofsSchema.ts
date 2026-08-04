import { ethers } from "ethers";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { hash } from "@/utils/hash";
import { FraudProofStorage } from "../../FraudProofStorage";
import { PersistenceSchema } from "../PersistenceSchema";

const persistenceAbiCoder = ethers.AbiCoder.defaultAbiCoder();

/**
 * The outer FraudProofStruct {proofType, participant, encodedProof} has no
 * Codec.Type (structToEthersType only maps inner proof-reason structs), so
 * it is hand-rolled with the same AbiCoder-envelope mechanism BlockStorage's
 * schema uses - never re-implement an on-chain validator in TS.
 */
function encodeFraudProof(fraudProof: FraudProofStruct): string {
    return persistenceAbiCoder.encode(
        ["uint256", "address", "bytes"],
        [fraudProof.proofType, fraudProof.participant, fraudProof.encodedProof]
    );
}

function decodeFraudProof(encodedFraudProof: string): FraudProofStruct {
    const [proofType, participant, encodedProof] = persistenceAbiCoder.decode(
        ["uint256", "address", "bytes"],
        encodedFraudProof
    );
    return { proofType, participant, encodedProof };
}

/**
 * Durability schema for the dispute-read fraud-proof store. DisputeManager
 * .constructDispute reads through FraudProofStorage.getFraudProofForParticipant
 * - a missed field here means the off-chain pipeline builds a proof the
 * on-chain apply handler rejects.
 *
 * The map key (proofHash = hash(encodedProof)) only fingerprints the inner
 * proof, not the outer {proofType, participant} envelope - storeFraudProof
 * overwrites the same key if the same encodedProof is re-stored under a
 * different proofType/participant. changeKey must therefore hash the FULL
 * encoded envelope, not just encodedProof, or an outer-field-only change is
 * invisible to the flush diff and never gets persisted. Replay routes
 * through storeFraudProof, which rebuilds the derived participantToProofs
 * index.
 */
export function fraudProofsSchema(
    raw: FraudProofStorage
): PersistenceSchema<FraudProofStruct> {
    return {
        id: "fraudProofs",

        entries: function* () {
            for (const [proofHash, fraudProof] of raw.persistableEntries()) {
                yield [proofHash as string, fraudProof];
            }
        },

        changeKey: (fraudProof) => hash(encodeFraudProof(fraudProof)),

        encode: encodeFraudProof,

        decode: decodeFraudProof,

        // No key override: storeFraudProof always keys by hash(encodedProof).
        replay: (encodedFraudProof) => {
            raw.storeFraudProof(decodeFraudProof(encodedFraudProof));
        }
    };
}
