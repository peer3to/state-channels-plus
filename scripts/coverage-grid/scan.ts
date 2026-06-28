import * as fs from "fs";
import * as path from "path";
import { MultiSet, parseCoord, coordKey } from "./coord";
import type { StructDef, EnumDef } from "./contracts";
import type { Coord } from "./coord";
import {
    ROOT,
    TEST_DIRS,
    INPUT_PROOF_ENUMS,
    OUTCOME_ENUM,
    PARTITIONS,
    BYZANTINE_TARGET
} from "./domain";
import { INVARIANT_DESCS, SETUP_FACETS } from "../../test/harness/scenario";

export interface Inferred {
    proof?: string;
    targets: Coord[];
    setup: string[];
}
export interface Scenario {
    name: string;
    file: string;
    line: number;
    proof?: string;
    targets: Coord[];
    invariant: string[];
    setup: string[];
    unreachable?: string;
    outcome?: string;
    inferred?: Inferred;
}
export interface Evidence {
    proofRefs: MultiSet;
    fieldRefs: MultiSet;
    scenarios: Scenario[];
    errors: string[];
}

const SETUP: Record<string, readonly string[]> = SETUP_FACETS;

// recursively collect test files under a dir
function walkTestFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        if (fs.statSync(full).isDirectory()) out.push(...walkTestFiles(full));
        else if (item.endsWith(".test.ts") || item.endsWith(".t.sol"))
            out.push(full);
    }
    return out;
}

// loose references: enum/field names mentioned anywhere in a file, not tied to a scenario
function countLooseRefs(
    src: string,
    rel: string,
    proofRefs: MultiSet,
    fieldRefs: MultiSet
): void {
    for (const m of src.matchAll(
        /(?:DisputeFraudProofType|FraudProofType)\.([A-Za-z0-9_]+)/g
    ))
        proofRefs.add(m[1], rel);
    for (const m of src.matchAll(/\binput\.([A-Za-z0-9_]+)/g))
        fieldRefs.add(`DisputeInput.${m[1]}`, rel);
    for (const m of src.matchAll(/\btimeout\.([A-Za-z0-9_]+)/g))
        fieldRefs.add(`Timeout.${m[1]}`, rel);
    for (const m of src.matchAll(
        /\bdispute\.(postedAuditingData|outputSnapshotDataHash)\b/g
    ))
        fieldRefs.add(`Dispute.${m[1]}`, rel);
}

function skipWs(s: string, i: number): number {
    while (i < s.length && /\s/.test(s[i])) i++;
    return i;
}

// read a scenario("title", { ...meta }) call from the start of `s`. scans the title as a
// string literal and brace-matches the meta object.
function readScenarioCall(s: string): { name: string; meta: string } | null {
    let i = s.indexOf("(");
    if (i < 0) return null;
    i = skipWs(s, i + 1);

    const quote = s[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;
    i++;
    let name = "";
    for (; i < s.length && s[i] !== quote; i++) {
        if (s[i] === "\\" && i + 1 < s.length) name += s[++i];
        else name += s[i];
    }
    if (i >= s.length) return null;

    i = skipWs(s, i + 1); // past the closing quote
    if (s[i] !== ",") return null;
    i = skipWs(s, i + 1);
    if (s[i] !== "{") return null;

    // brace-match the meta object, ignoring braces inside string literals
    const metaStart = i;
    let depth = 0;
    let str: string | null = null;
    for (; i < s.length; i++) {
        const ch = s[i];
        if (str) {
            if (ch === "\\") i++;
            else if (ch === str) str = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
            str = ch;
        } else if (ch === "{") {
            depth++;
        } else if (ch === "}" && --depth === 0) {
            return { name, meta: s.slice(metaStart, i + 1) };
        }
    }
    return null;
}

interface ScenarioBlock {
    name: string;
    meta: string;
    line: number;
    bodyStart: number;
}

// every scenario() call in a file, with its meta object source and body offset
function extractScenarioBlocks(lines: string[]): ScenarioBlock[] {
    const blocks: ScenarioBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*scenario(?:\.(?:skip|only))?\(/.test(lines[i])) continue;
        const call = readScenarioCall(lines.slice(i).join("\n"));
        if (call)
            blocks.push({
                name: call.name,
                meta: call.meta,
                line: i + 1,
                bodyStart: i
            });
    }
    return blocks;
}

interface ParsedMeta {
    proof?: string;
    outcome?: string;
    unreachable?: string;
    invariant: string[];
    targets: string[];
    setup: string[];
}

// pull the typed fields out of a meta object's source text
function parseMeta(meta: string): ParsedMeta {
    const str = (key: string) =>
        meta.match(new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]*)["'\`]`))?.[1];
    const list = (key: string): string[] => {
        const m = meta.match(
            new RegExp(`\\b${key}\\s*:\\s*(\\[[^\\]]*\\]|["'\`][^"'\`]*["'\`])`)
        );
        return m
            ? [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1])
            : [];
    };
    return {
        proof: str("proof"),
        outcome: str("outcome"),
        unreachable: str("unreachable"),
        invariant: list("invariant"),
        targets: list("target"),
        setup: list("setup")
    };
}

const TEST_START = /^\s*(scenario|it|describe)(\.(skip|only))?\s*\(/;

// the source from a scenario down to the next test/tag - the window inference reads
function bodyFrom(lines: string[], start: number): string {
    let e = start + 1;
    while (
        e < lines.length &&
        !TEST_START.test(lines[e]) &&
        !/^\s*\/\/\s*@scenario/.test(lines[e])
    )
        e++;
    return lines.slice(start, e).join("\n");
}

// infer coordinate fragments from a test body (conservative - only confident signals)
function inferFromBody(body: string): Inferred {
    const proofs = [
        ...body.matchAll(
            /(?:DisputeFraudProofType|FraudProofType)\.([A-Za-z0-9_]+)/g
        )
    ].map((m) => m[1]);
    const distinct = [...new Set(proofs)];
    const proof = distinct.length === 1 ? distinct[0] : undefined;

    // a stub/tamper test uses byzantine as a trigger, not the target
    const hasTamper =
        /stubConstructDispute|postTamperedDispute|postFraudulentSnapshot|plantFreshTimeout/.test(
            body
        );
    const targets = hasTamper
        ? []
        : [...body.matchAll(/\bbyzantine\.([A-Za-z0-9_]+)\(/g)]
              .map((m) => BYZANTINE_TARGET[m[1]])
              .filter(Boolean);

    const setup: string[] = [];
    if (/expectMilestonesOnlyStateProof/.test(body))
        setup.push("proof:milestones");
    else if (/expectSignedBlocksOnlyStateProof/.test(body))
        setup.push("proof:signedblocks");
    else if (/preDisputeSetupCalldataPath/.test(body))
        setup.push("proof:milestones");
    else if (/preDisputeSetupDisconnectedPeer/.test(body))
        setup.push("proof:signedblocks");
    if (
        /preDisputeSetupCalldataPath|uploadDisputeWithCalldata|postedAuditingData\s*=\s*true|initiatedWithAuditingData:\s*true|\[calldata posted\]/.test(
            body
        )
    )
        setup.push("calldata:posted");
    else if (
        /\[no calldata\]|initiatedWithAuditingData:\s*false|preDisputeSetupDisconnectedPeer|\bpreDisputeSetup\(/.test(
            body
        )
    )
        setup.push("calldata:absent");

    return { proof, targets, setup };
}

// every rule that makes a scenario's tags valid against the contracts/domain -> the violations
function validateScenario(
    sc: Scenario,
    structs: Map<string, StructDef>,
    allProofMembers: Set<string>,
    outcomeMembers: Set<string>
): string[] {
    const where = `${sc.file}:${sc.line} @${sc.name}`;
    const errors: string[] = [];
    if (sc.proof && !allProofMembers.has(sc.proof))
        errors.push(`${where} unknown proof "${sc.proof}"`);
    if (sc.outcome && !outcomeMembers.has(sc.outcome))
        errors.push(`${where} unknown outcome "${sc.outcome}"`);
    for (const t of sc.targets) {
        const classes = PARTITIONS[t.struct]?.[t.field];
        if (!structs.get(t.struct)?.fields.some((f) => f.name === t.field))
            errors.push(`${where} unknown field ${t.struct}.${t.field}`);
        else if (!classes)
            errors.push(
                `${where} ${t.struct}.${t.field} has no value-classes modeled`
            );
        else if (!classes.includes(t.cls))
            errors.push(
                `${where} unknown class ${coordKey(t)} (have: ${classes.join("|")})`
            );
    }
    for (const inv of sc.invariant)
        if (!(inv in INVARIANT_DESCS))
            errors.push(
                `${where} unknown invariant "${inv}" (have: ${Object.keys(INVARIANT_DESCS).join("|")})`
            );
    for (const su of sc.setup) {
        const [facet, cls] = su.split(":");
        const classes = SETUP[facet];
        if (!classes)
            errors.push(
                `${where} unknown setup facet "${su}" (have: ${Object.keys(SETUP).join("|")})`
            );
        else if (!classes.includes(cls))
            errors.push(
                `${where} unknown setup class "${su}" (have ${facet}: ${classes.join("|")})`
            );
    }
    if (sc.unreachable && sc.targets.length === 0)
        errors.push(`${where} 'unreachable:' needs a target cell to mark N/A`);
    return errors;
}

export function gather(
    structs: Map<string, StructDef>,
    enums: Map<string, EnumDef>
): Evidence {
    const proofRefs = new MultiSet();
    const fieldRefs = new MultiSet();
    const scenarios: Scenario[] = [];
    const errors: string[] = [];

    const allProofMembers = new Set(
        INPUT_PROOF_ENUMS.flatMap((e) => enums.get(e)?.members ?? [])
    );
    const outcomeMembers = new Set(enums.get(OUTCOME_ENUM)?.members ?? []);

    for (const file of TEST_DIRS.flatMap(walkTestFiles)) {
        const rel = path.relative(ROOT, file);
        const src = fs.readFileSync(file, "utf8");
        const lines = src.split("\n");

        countLooseRefs(src, rel, proofRefs, fieldRefs);

        for (const block of extractScenarioBlocks(lines)) {
            const sc: Scenario = {
                name: block.name,
                file: rel,
                line: block.line,
                targets: [],
                invariant: [],
                setup: []
            };
            const meta = parseMeta(block.meta);
            // assign proof/outcome unconditionally (even when undefined) so the key slot is
            // reserved before `inferred` - build.ts fills proof from inference and relies on it
            sc.proof = meta.proof;
            sc.outcome = meta.outcome;
            if (meta.unreachable !== undefined)
                sc.unreachable = meta.unreachable;
            sc.invariant = meta.invariant;
            sc.setup = meta.setup;
            for (const raw of meta.targets) {
                const c = parseCoord(raw);
                if (!c)
                    errors.push(
                        `${rel}:${sc.line} @${sc.name} bad target "${raw}" (want Struct.field:class)`
                    );
                else sc.targets.push(c);
            }
            errors.push(
                ...validateScenario(
                    sc,
                    structs,
                    allProofMembers,
                    outcomeMembers
                )
            );
            sc.inferred = inferFromBody(bodyFrom(lines, block.bodyStart));
            scenarios.push(sc);
        }
    }
    return { proofRefs, fieldRefs, scenarios, errors };
}
