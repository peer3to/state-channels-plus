const fs = require("fs");
const path = require("path");
const { Project, VariableDeclarationKind } = require("ts-morph");
const config = require("./config");

function generateArtifacts() {
    const {
        DIAMOND_PROXY_PATH,
        STATE_MACHINE_PATH,
        OUTPUT_PATH,
        FACETS,
        STATE_MACHINE_CONTRACTS
    } = config.ARTIFACTS_CONFIG;

    // Resolve paths relative to script directory
    const artifactsPath = path.join(__dirname, DIAMOND_PROXY_PATH);
    const stateMachineArtifactsPath = path.join(__dirname, STATE_MACHINE_PATH);
    const outputPath = path.join(__dirname, OUTPUT_PATH);

    // Load artifacts
    const artifacts = FACETS.map((facet) => {
        const artifactPath = path.join(
            artifactsPath,
            `${facet}.sol/${facet}.json`
        );
        return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    });

    const stateMachineArtifacts = STATE_MACHINE_CONTRACTS.map((contract) => {
        const artifactPath = path.join(
            stateMachineArtifactsPath,
            `${contract}.sol/${contract}.json`
        );
        return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    });

    const allArtifacts = [...artifacts, ...stateMachineArtifacts];

    // Extract error ABIs
    const errorAbis = allArtifacts.flatMap((artifact) => {
        return artifact.abi.filter((item) => item.type === "error");
    });

    // Generate TypeScript file using ts-morph
    const project = new Project();
    const sourceFile = project.createSourceFile(outputPath, "", {
        overwrite: true
    });

    // Add file header
    sourceFile.insertText(
        0,
        `${config.FILE_HEADER}\n// Generated from build artifacts\n\n`
    );

    // Add main artifacts export
    sourceFile.addVariableStatement({
        isExported: true,
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
            {
                name: "artifacts",
                initializer: `${JSON.stringify(allArtifacts, null, 2)} as const`
            }
        ]
    });

    // Add error ABIs export
    sourceFile.addVariableStatement({
        isExported: true,
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
            {
                name: "errorAbis",
                initializer: `${JSON.stringify(errorAbis, null, 2)} as const`
            }
        ]
    });

    // Add comment for individual exports
    sourceFile.insertText(
        sourceFile.getEnd(),
        "\n// Individual artifact exports for convenience\n"
    );

    // Add individual facet exports
    FACETS.forEach((facet) => {
        sourceFile.addVariableStatement({
            isExported: true,
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
                {
                    name: `${facet}Artifact`,
                    initializer: `artifacts.find(a => a.contractName === "${facet}")!`
                }
            ]
        });
    });

    // Add individual state machine exports
    STATE_MACHINE_CONTRACTS.forEach((contract) => {
        sourceFile.addVariableStatement({
            isExported: true,
            declarationKind: VariableDeclarationKind.Const,
            declarations: [
                {
                    name: `${contract}Artifact`,
                    initializer: `artifacts.find(a => a.contractName === "${contract}")!`
                }
            ]
        });
    });

    // Save file
    sourceFile.saveSync();
    console.log(config.ARTIFACTS_SUCCESS_MESSAGE(outputPath));
}

// Export for use in generate-all.js
module.exports = { generateArtifacts };

// Run directly if called as script
if (require.main === module) {
    generateArtifacts();
}
