// Scan test/unit/<subsystem>/ folders: load each folder's domain.ts,
// extract the covers() metas from its native mocha tests (testExtractor),
// and resolve them into coverage units against the domain (claimResolver).

import * as fs from "fs";
import * as path from "path";
import type { Domain } from "../../test/unit/framework/domain";
import { BLOCKED_KEY, extractTests, type ScannedTest } from "./testExtractor";
import { fieldsOf, validateAndResolve } from "./claimResolver";

export type { CellValue, ClaimedCell, ScannedTest } from "./testExtractor";
export { unreachableReason } from "./claimResolver";

export const ROOT = path.join(__dirname, "../..");
export const UNIT_DIR = path.join(ROOT, "test/unit");
export const FRAMEWORK_DIR = "framework";

export interface SubsystemScan {
    folder: string;
    domain: Domain;
    tests: ScannedTest[];
    errors: string[];
}

export function listSubsystemFolders(): string[] {
    return fs
        .readdirSync(UNIT_DIR)
        .filter(
            (name) =>
                name !== FRAMEWORK_DIR &&
                fs.statSync(path.join(UNIT_DIR, name)).isDirectory()
        )
        .sort();
}

function walkTestFiles(dir: string): string[] {
    const out: string[] = [];
    for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        if (fs.statSync(full).isDirectory()) out.push(...walkTestFiles(full));
        else if (item.endsWith(".test.ts")) out.push(full);
    }
    return out.sort();
}

function loadDomain(folder: string, errors: string[]): Domain | null {
    const domainPath = path.join(UNIT_DIR, folder, "domain.ts");
    if (!fs.existsSync(domainPath)) {
        errors.push(
            `test/unit/${folder}/ has no domain.ts - every subsystem folder must define its domain`
        );
        return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(UNIT_DIR, folder, "domain"));
    const domain = mod.domain as Domain | undefined;
    if (!domain?.subsystem || !domain.matrices) {
        errors.push(
            `test/unit/${folder}/domain.ts must \`export const domain = defineDomain(...)\``
        );
        return null;
    }
    // flat-meta rules: a field may live in at most ONE variants matrix, and
    // "blocked" is reserved
    const variantFieldOwner = new Map<string, string>();
    for (const [name, matrix] of Object.entries(domain.matrices)) {
        for (const field of Object.keys(fieldsOf(matrix))) {
            if (field === BLOCKED_KEY)
                errors.push(
                    `test/unit/${folder}/domain.ts: "${BLOCKED_KEY}" is a reserved meta key and can't be a field/axis name (${name})`
                );
            if (matrix.kind !== "variants") continue;
            const owner = variantFieldOwner.get(field);
            if (owner)
                errors.push(
                    `test/unit/${folder}/domain.ts: field "${field}" lives in two variants matrices (${owner}, ${name}) - flat metas would be ambiguous; rename one`
                );
            else variantFieldOwner.set(field, name);
        }
    }
    return domain;
}

export function scanSubsystem(folder: string): SubsystemScan {
    const errors: string[] = [];
    const tests: ScannedTest[] = [];
    const domain = loadDomain(folder, errors);

    for (const file of walkTestFiles(path.join(UNIT_DIR, folder)))
        extractTests(file, path.relative(ROOT, file), tests, errors);

    if (domain) for (const t of tests) validateAndResolve(domain, t, errors);

    return {
        folder,
        domain: domain ?? { subsystem: folder, matrices: {} },
        tests,
        errors
    };
}
