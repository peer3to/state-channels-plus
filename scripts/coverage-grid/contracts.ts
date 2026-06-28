import * as fs from "fs";
import * as path from "path";
import { parse, visit } from "@solidity-parser/parser";
import { coordKey } from "./coord";

export interface StructDef {
    name: string;
    fields: { name: string; type: string }[];
    file: string;
}
export interface EnumDef {
    name: string;
    members: string[];
    file: string;
}

import {
    ROOT,
    PARTITIONS,
    PARTITIONED_STRUCTS,
    BYZANTINE_TARGET,
    INPUT_PROOF_ENUMS,
    OUTCOME_ENUM
} from "./domain";

function typeToString(t: any): string {
    if (!t) return "?";
    switch (t.type) {
        case "ElementaryTypeName":
            return t.name;
        case "UserDefinedTypeName":
            return t.namePath;
        case "ArrayTypeName":
            return `${typeToString(t.baseTypeName)}[]`;
        case "Mapping":
            return `mapping(${typeToString(t.keyType)} => ${typeToString(t.valueType)})`;
        default:
            return t.name ?? t.type ?? "?";
    }
}

export function parseTypes(dir: string) {
    const structs = new Map<string, StructDef>();
    const enums = new Map<string, EnumDef>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sol"))) {
        const full = path.join(dir, file);
        const ast = parse(fs.readFileSync(full, "utf8"), { tolerant: true });
        const rel = path.relative(ROOT, full);
        visit(ast, {
            StructDefinition: (s: any) =>
                structs.set(s.name, {
                    name: s.name,
                    file: rel,
                    fields: s.members.map((m: any) => ({
                        name: m.name,
                        type: typeToString(m.typeName)
                    }))
                }),
            EnumDefinition: (e: any) =>
                enums.set(e.name, {
                    name: e.name,
                    file: rel,
                    members: e.members.map((m: any) => m.name)
                })
        });
    }
    return { structs, enums };
}

export function validateDomain(
    structs: Map<string, StructDef>,
    enums: Map<string, EnumDef>
): string[] {
    const errors: string[] = [];

    for (const e of [...INPUT_PROOF_ENUMS, OUTCOME_ENUM])
        if (!enums.has(e))
            errors.push(`[domain] enum "${e}" not found in contracts`);

    for (const structName of PARTITIONED_STRUCTS) {
        const def = structs.get(structName);
        if (!def) {
            errors.push(
                `[domain] PARTITIONS struct "${structName}" not found in contracts`
            );
            continue;
        }
        for (const field of Object.keys(PARTITIONS[structName]))
            if (!def.fields.some((f) => f.name === field))
                errors.push(
                    `[domain] PARTITIONS ${structName}.${field} is not a field of ${structName}`
                );
    }

    for (const [helper, c] of Object.entries(BYZANTINE_TARGET)) {
        const classes = PARTITIONS[c.struct]?.[c.field];
        if (!structs.get(c.struct)?.fields.some((f) => f.name === c.field))
            errors.push(
                `[domain] BYZANTINE_TARGET.${helper} -> unknown field ${c.struct}.${c.field}`
            );
        else if (!classes?.includes(c.cls))
            errors.push(
                `[domain] BYZANTINE_TARGET.${helper} -> unmodeled class ${coordKey(c)}`
            );
    }

    return errors;
}
