const artifacts_base_path =
    "../../artifacts/contracts/V1/StateChannelDiamondProxy/";
const facets = [
    "AStateChannelManagerProxy",
    "DisputeManagerFacet",
    "DisputeFraudProofFacet",
    "FraudProofFacet",
    "JoinChannelFacet",
    "StateChannelCommon",
    "StateSnapshotFacet"
];
export const artifacts = facets.map((facet) => {
    return require(`${artifacts_base_path}/${facet}.sol/${facet}.json`);
});

export const errorAbis = artifacts.flatMap((artifact) => {
    return artifact.abi.filter((item: any) => item.type === "error");
});

/**
 * Enum containing contract errors that require specific handling actions.
 *
 * Only errors in this enum require specific actions to be taken (like retry logic,
 * state updates, etc.), all other errors are can be simply logged for debugging purposes.
 *
 */
export enum ContractErrors {
    DISPUTE_COMMITMENT_NOT_AVAILABLE = "ErrorDisputeCommitmentNotAvailable"
}
