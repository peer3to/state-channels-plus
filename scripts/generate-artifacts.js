const fs = require("fs");
const path = require("path");

const artifactsPath = path.join(
    __dirname,
    "../artifacts/contracts/V1/StateChannelDiamondProxy/"
);
const outputPath = path.join(__dirname, "../src/utils/GeneratedArtifacts.ts");

const facets = [
    "AStateChannelManagerProxy",
    "DisputeManagerFacet",
    "DisputeFraudProofFacet",
    "FraudProofFacet",
    "JoinChannelFacet",
    "StateChannelCommon",
    "StateSnapshotFacet"
];

const artifacts = facets.map((facet) => {
    const artifactPath = path.join(artifactsPath, `${facet}.sol/${facet}.json`);
    return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
});

const errorAbis = artifacts.flatMap((artifact) => {
    return artifact.abi.filter((item) => item.type === "error");
});

// Generate TypeScript module
const generatedCode = `// This file is auto-generated. Do not edit manually.
// Generated from build artifacts

export const artifacts = ${JSON.stringify(artifacts, null, 2)} as const;

export const errorAbis = ${JSON.stringify(errorAbis, null, 2)} as const;

// Individual artifact exports for convenience
${facets.map((facet) => `export const ${facet}Artifact = artifacts.find(a => a.contractName === "${facet}")!;`).join("\n")}
`;

fs.writeFileSync(outputPath, generatedCode);
console.log(`Generated artifacts module at ${outputPath}`);
