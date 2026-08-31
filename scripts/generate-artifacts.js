const fs = require("fs");
const path = require("path");

const artifactsPath = path.join(
    __dirname,
    "../artifacts/contracts/V1/StateChannelDiamondProxy/"
);
const stateMachineArtifactsPath = path.join(
    __dirname,
    "../artifacts/contracts/V1/"
);
const outputPath = path.join(__dirname, "../src/utils/GeneratedArtifacts.ts");

const facets = [
    "StateChannelManagerProxy",
    "AConsumerFacet",
    "DisputeManagerFacet",
    "DisputeFraudProofFacet",
    "DisputeVerificationFacet",
    "FraudProofFacet",
    "JoinChannelFacet",
    "StateChannelCommon",
    "StateSnapshotFacet",
    "StateProofFacet",
    "UtilityFacet",
    "LocalDiamond"
];
const stateMachineContracts = ["AStateMachine"];

const artifacts = facets.map((facet) => {
    const artifactPath = path.join(artifactsPath, `${facet}.sol/${facet}.json`);
    return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
});
const stateMachineArtifacts = stateMachineContracts.map((artifact) => {
    const artifactPath = path.join(
        stateMachineArtifactsPath,
        `${artifact}.sol/${artifact}.json`
    );
    return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
});

const allArtifacts = [...artifacts, ...stateMachineArtifacts];

const errorAbis = allArtifacts.flatMap((artifact) => {
    return artifact.abi.filter((item) => item.type === "error");
});

// Generate TypeScript module
const generatedCode = `// This file is auto-generated. Do not edit manually.
// Generated from build artifacts

import { Artifact } from '../types/artifacts';

export const artifacts: Artifact[] = ${JSON.stringify(allArtifacts, null, 2)};

export const errorAbis = ${JSON.stringify(errorAbis, null, 2)} as const;

// Individual artifact exports for convenience
${facets.map((facet) => `export const ${facet}Artifact: Artifact = artifacts.find(a => a.contractName === "${facet}")!;`).join("\n")}

${stateMachineContracts.map((contract) => `export const ${contract}Artifact: Artifact = artifacts.find(a => a.contractName === "${contract}")!;`).join("\n")}
`;

fs.writeFileSync(outputPath, generatedCode);
console.log(`Generated artifacts module at ${outputPath}`);
