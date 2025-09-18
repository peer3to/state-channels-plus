module.exports = {
    // File paths
    TYPES_DIR: "../artifacts/contracts/V1/types/",
    GENERATED_ETHERS_OUTPUT_PATH: "../src/types/generated-ethers.ts",
    GENERATED_CODEC_OUTPUT_PATH: "../src/utils/generated-codec.ts",
    GENERATED_ETHERS_IMPORT_PATH: "../types/generated-ethers",

    // File headers
    FILE_HEADER: "// Auto-generated. Do not edit.",

    // Artifacts configuration
    ARTIFACTS_CONFIG: {
        DIAMOND_PROXY_PATH:
            "../artifacts/contracts/V1/StateChannelDiamondProxy/",
        STATE_MACHINE_PATH: "../artifacts/contracts/V1/",
        OUTPUT_PATH: "../src/utils/GeneratedArtifacts.ts",
        FACETS: [
            "StateChannelManagerProxy",
            "AConsumerFacet",
            "DisputeManagerFacet",
            "DisputeFraudProofFacet",
            "FraudProofFacet",
            "JoinChannelFacet",
            "StateChannelCommon",
            "StateSnapshotFacet",
            "LocalDiamond"
        ],
        STATE_MACHINE_CONTRACTS: ["AStateMachine"]
    },

    // Success messages
    ETHERS_SUCCESS_MESSAGE: (count) => `Generated ${count} ethers types`,
    CODEC_SUCCESS_MESSAGE: (path) =>
        `Generated codec mappings saved to: ${path}`,
    ARTIFACTS_SUCCESS_MESSAGE: (path) => `Generated artifacts module at ${path}`
};
