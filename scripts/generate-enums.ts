import * as fs from "fs";
import * as path from "path";
import { parse, visit } from "@solidity-parser/parser";

interface EnumDef {
    name: string;
    values: string[];
}

const BASE_OFFSET = 100;
const enumOffset = (i: number) => (i + 1) * BASE_OFFSET;

function findSolFiles(dir: string): string[] {
    const files: string[] = [];

    function traverse(currentDir: string) {
        const items = fs.readdirSync(currentDir);

        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                traverse(fullPath);
            } else if (item.endsWith(".sol")) {
                files.push(fullPath);
            }
        }
    }

    traverse(dir);
    return files;
}

function extractEnumsFromFile(filePath: string): EnumDef[] {
    try {
        const source = fs.readFileSync(filePath, "utf8");
        const ast = parse(source, { tolerant: true });
        const enums: EnumDef[] = [];

        visit(ast, {
            EnumDefinition: (enumDef) => {
                const values = enumDef.members.map((member) => member.name);
                enums.push({
                    name: enumDef.name,
                    values
                });
            }
        });

        return enums;
    } catch (error) {
        console.warn(
            `Warning: Could not parse ${filePath}: ${(error as Error).message}`
        );
        return [];
    }
}

function generateTSEnum(enumDef: EnumDef, enumIndex: number): string {
    const valueLines = enumDef.values.map((value, index) => {
        if (index === 0) {
            return `  ${value} = ${enumOffset(enumIndex)},`;
        }
        return `  ${value},`;
    });

    return `export enum ${enumDef.name} {\n${valueLines.join("\n")}\n}`;
}

const generateHelperFunctions = (enumDefs: EnumDef[]): string =>
    enumDefs
        .map(
            (enumDef, index) =>
                `export const toSolidity${enumDef.name} = (value: ${enumDef.name}) => value % ${enumOffset(index)};`
        )
        .join("\n\n");

function main() {
    const contractsDir = path.join(__dirname, "../contracts");
    const outputFile = path.join(__dirname, "../src/types/sol-enums.ts");

    const solFiles = findSolFiles(contractsDir);
    const allEnums: EnumDef[] = [];

    for (const file of solFiles) {
        const enums = extractEnumsFromFile(file);
        allEnums.push(...enums);
    }

    const tsEnums = allEnums.map((enumDef, index) =>
        generateTSEnum(enumDef, index)
    );
    const helperFunctions = generateHelperFunctions(allEnums);

    const generatedCode = `// Auto-generated from Solidity contracts. Do not edit manually.\n\n${tsEnums.join("\n\n")}\n\n${helperFunctions}\n`;

    fs.writeFileSync(outputFile, generatedCode);
}

main();
