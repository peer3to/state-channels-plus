const { Project } = require("ts-morph");
const fs = require("fs");
const path = require("path");
const config = require("./config");

function generateCodecMappings(srcPath) {
    const generatedEthersPath = path.join(srcPath, "types/generated-ethers.ts");
    const content = fs.readFileSync(generatedEthersPath, "utf8");

    const ethersTypeMatches =
        content.match(/export const (\w+)EthersType = /g) || [];
    const availableTypes = ethersTypeMatches.map((match) =>
        match.replace("export const ", "").replace("EthersType = ", "")
    );

    const project = new Project();
    const outputPath = path.join(srcPath, "utils/generated-codec.ts");
    const file = project.createSourceFile(outputPath, "", { overwrite: true });

    file.addImportDeclaration({
        namedImports: availableTypes.map((t) => `${t}EthersType`),
        moduleSpecifier: config.GENERATED_ETHERS_IMPORT_PATH
    });

    file.addImportDeclaration({
        namedImports: ["FraudProofType"],
        moduleSpecifier: "../types/disputes"
    });

    // Re-export FraudProofType so it can be imported from this module
    file.addExportDeclaration({
        namedExports: ["FraudProofType"],
        moduleSpecifier: "../types/disputes"
    });

    file.addEnum({
        isExported: true,
        name: "Type",
        members: availableTypes.map((type) => ({ name: type }))
    });

    const mapEntries = [
        ...availableTypes.map((type) => `[Type.${type}, ${type}EthersType]`),
        "[FraudProofType.BlockDoubleSign, BlockDoubleSignProofEthersType]",
        "[FraudProofType.BlockInvalidStateTransition, BlockInvalidStateTransitionProofEthersType]",
        "[FraudProofType.InvalidTimestamp, InvalidTimestampProofEthersType]",
        "[FraudProofType.WrongGenesis, WrongGenesisProofEthersType]"
    ];

    file.addVariableStatement({
        isExported: true,
        declarationKind: "const",
        declarations: [
            {
                name: "TYPE_TO_ETHERS_TYPE_MAP",
                initializer: `new Map<Type | FraudProofType, string>([\n    ${mapEntries.join(",\n    ")}\n])`
            }
        ]
    });

    file.addFunction({
        isExported: true,
        name: "getEthersType",
        parameters: [{ name: "type", type: "Type | FraudProofType" }],
        returnType: "string",
        statements: `const ethersType = TYPE_TO_ETHERS_TYPE_MAP.get(type);
if (!ethersType) {
    throw new Error(\`No ethers type mapping found for \${type}\`);
}
return ethersType;`
    });

    file.saveSync();
    console.log(config.CODEC_SUCCESS_MESSAGE(outputPath));
}

module.exports = { generateCodecMappings };
