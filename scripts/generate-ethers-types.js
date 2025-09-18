const fs = require("fs");
const path = require("path");

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
    const typesDir = path.join(__dirname, "../artifacts/contracts/V1/types/");
    const outputPath = path.join(__dirname, "../src/types/generated-ethers.ts");
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

    let generatedCode = `// Auto-generated. Do not edit.\n\n`;

    for (const [structName, components] of allStructs) {
        const ethersType = generateEthersTypeString(
            structName,
            components,
            allStructs
        );
        generatedCode += `export const ${structName}EthersType = \`${ethersType}\`;\n\n`;
    }

    fs.writeFileSync(outputPath, generatedCode);
    console.log(`Generated ${allStructs.size} ethers types`);
}

if (require.main === module) {
    generateEthersTypes();
}

module.exports = { generateEthersTypes };
