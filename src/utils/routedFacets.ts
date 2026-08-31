import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import DisputeVerificationFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol/DisputeVerificationFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import StateProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol/StateProofFacet.json";
import UtilityFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol/UtilityFacet.json";
import {
    DisputeFraudProofFacet__factory,
    DisputeManagerFacet__factory,
    DisputeVerificationFacet__factory,
    FraudProofFacet__factory,
    JoinChannelFacet__factory,
    StateProofFacet__factory,
    StateSnapshotFacet__factory,
    UtilityFacet__factory
} from "@typechain-types";

/** The single production-owned inventory of facets routed by the manager proxy. */
export const routedFacets = [
    {
        facetName: "DisputeManagerFacet",
        factory: DisputeManagerFacet__factory,
        artifact: DisputeManagerFacetArtifact
    },
    {
        facetName: "DisputeVerificationFacet",
        factory: DisputeVerificationFacet__factory,
        artifact: DisputeVerificationFacetArtifact
    },
    {
        facetName: "FraudProofFacet",
        factory: FraudProofFacet__factory,
        artifact: FraudProofFacetArtifact
    },
    {
        facetName: "DisputeFraudProofFacet",
        factory: DisputeFraudProofFacet__factory,
        artifact: DisputeFraudProofFacetArtifact
    },
    {
        facetName: "StateSnapshotFacet",
        factory: StateSnapshotFacet__factory,
        artifact: StateSnapshotFacetArtifact
    },
    {
        facetName: "JoinChannelFacet",
        factory: JoinChannelFacet__factory,
        artifact: JoinChannelFacetArtifact
    },
    {
        facetName: "StateProofFacet",
        factory: StateProofFacet__factory,
        artifact: StateProofFacetArtifact
    },
    {
        facetName: "UtilityFacet",
        factory: UtilityFacet__factory,
        artifact: UtilityFacetArtifact
    }
] as const;

export const routedFacetArtifacts = routedFacets.map(
    ({ artifact }) => artifact
);
