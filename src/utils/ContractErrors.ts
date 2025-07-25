import path from "path";
import fs from "fs";

const getArtifactsPath = () => {
    // Try development path first (when running tests/development)
    // From src/utils/ContractErrors.ts, go up to project root: ../../../artifacts/...
    const devPath = path.join(
        __dirname,
        "../../../artifacts/contracts/V1/StateChannelDiamondProxy/"
    );
    if (fs.existsSync(devPath)) {
        return devPath;
    }

    // Try built package path (when installed via npm)
    // From dist/src/utils/ContractErrors.js, go up to dist: ../../artifacts/...
    const builtPath = path.join(
        __dirname,
        "../../artifacts/contracts/V1/StateChannelDiamondProxy/"
    );
    if (fs.existsSync(builtPath)) {
        return builtPath;
    }

    throw new Error(
        'Could not find artifacts directory. Make sure the package is built correctly or run "yarn compile" first.'
    );
};

const artifacts_base_path = getArtifactsPath();
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
    const artifactPath = path.join(
        artifacts_base_path,
        `${facet}.sol/${facet}.json`
    );
    return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
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
