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
 * Fraud proofs are content-addressed (proofHash = hash(encodedProof)) and
 * first-write (storeFraudProof never merges), so `changeKey` recomputes the
 * same hash: immutable-after-store, the key is a sufficient fingerprint.
 * Replay routes through storeFraudProof, which rebuilds the derived
 * participantToProofs index.
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

        changeKey: (fraudProof) => hash(fraudProof.encodedProof),

        encode: encodeFraudProof,

        decode: decodeFraudProof,

        replay: (encodedFraudProof) => {
            raw.storeFraudProof(decodeFraudProof(encodedFraudProof));
        }
    };
}
