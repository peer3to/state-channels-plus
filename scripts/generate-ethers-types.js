const { Project } = require("ts-morph");
const fs = require("fs");
const path = require("path");
const config = require("./config");

function extractStructsFromABI(abi) {
    const structs = new Map();

    for (const item of abi) {
        if (
            item.type === "function" ||
            item.type === "event" ||
            item.type === "constructor"
        ) {
            const allInputs = [...(item.inputs || []), ...(item.outputs || [])];

            for (const input of allInputs) {
                collectStructsRecursive(input, structs);
            }
        }
    }

    return structs;
}

function collectStructsRecursive(input, structs) {
    if (input.internalType && input.internalType.startsWith("struct")) {
        const structName = input.internalType
            .replace(/^struct\s+/, "")
            .replace(/\[\]$/, "")
            .split(".")
            .pop();
        if (input.components && !structs.has(structName)) {
            structs.set(structName, input.components);

            for (const component of input.components) {
                collectStructsRecursive(component, structs);
            }
        }
    }
}

function generateEthersTypeString(structName, components, allStructs) {
    const fields = components.map((comp) => {
        if (comp.internalType && comp.internalType.startsWith("struct")) {
            const nestedStructName = comp.internalType
                .replace(/^struct\s+/, "")
                .replace(/\[\]$/, "")
                .split(".")
                .pop();
            const isArray = comp.internalType.endsWith("[]");
            const nestedStruct = allStructs.get(nestedStructName);

            if (nestedStruct) {
                const nestedType = generateEthersTypeString(
                    nestedStructName,
                    nestedStruct,
                    allStructs
                );
                return isArray ? `${nestedType}[]` : nestedType;
            }
        }

        return comp.type;
    });

    return `tuple(${fields.join(",")})`;
}

function generateEthersTypes() {
    const typesDir = path.join(__dirname, config.TYPES_DIR);
    const outputPath = path.join(
        __dirname,
        config.GENERATED_ETHERS_OUTPUT_PATH
    );
    const allStructs = new Map();

    const typeDirs = fs
        .readdirSync(typesDir)
        .filter((dir) => fs.statSync(path.join(typesDir, dir)).isDirectory());

    for (const typeDir of typeDirs) {
        const artifactPath = path.join(
            typesDir,
            typeDir,
            `${typeDir.replace(".sol", "")}.json`
        );

        if (fs.existsSync(artifactPath)) {
            const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
            const structs = extractStructsFromABI(artifact.abi);

            for (const [structName, components] of structs) {
                if (!allStructs.has(structName)) {
                    allStructs.set(structName, components);
                }
            }
        }
    }

    // Use ts-morph to generate the file
    const project = new Project();
    const file = project.createSourceFile(outputPath, "", { overwrite: true });

    // Add file header comment
    file.insertText(0, `${config.FILE_HEADER}\n\n`);

    // Add exports for each struct
    for (const [structName, components] of allStructs) {
        const ethersType = generateEthersTypeString(
            structName,
            components,
            allStructs
        );

        file.addVariableStatement({
            isExported: true,
            declarationKind: "const",
            declarations: [
                {
                    name: `${structName}EthersType`,
                    initializer: `\`${ethersType}\``
                }
            ]
        });
    }

    file.saveSync();
    console.log(config.ETHERS_SUCCESS_MESSAGE(allStructs.size));
}

if (require.main === module) {
    generateEthersTypes();
}

module.exports = { generateEthersTypes };
