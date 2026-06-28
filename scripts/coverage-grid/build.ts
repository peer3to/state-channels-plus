import { MultiMap, statusOf, coordKey, fieldKey, type Status } from "./coord";
import type { Scenario } from "./scan";
import { SETUP_FACETS } from "../../test/harness/scenario";
import { parseTypes, validateDomain } from "./contracts";
import { gather } from "./scan";
import {
    TYPES_DIR,
    INPUT_PROOF_ENUMS,
    PARTITIONS,
    PARTITIONED_STRUCTS,
    CARRIER_INTERACTION,
    CALLDATA_INTERACTION
} from "./domain";

export function buildModel() {
    const { structs, enums } = parseTypes(TYPES_DIR);
    const ev = gather(structs, enums);
    ev.errors.unshift(...validateDomain(structs, enums));
    const gaps: string[] = [];

    // fill gaps the tag omits from what the test actually does; cross-check what it declares
    const crossChecks: string[] = [];
    for (const sc of ev.scenarios) {
        const inf = sc.inferred;
        if (!inf) continue;
        if (sc.proof && inf.proof && sc.proof !== inf.proof)
            crossChecks.push(
                `${sc.name}: tag proof '${sc.proof}' != asserted '${inf.proof}'`
            );
        if (!sc.proof && inf.proof) sc.proof = inf.proof;
        if (sc.targets.length === 0 && inf.targets.length)
            sc.targets = inf.targets;
        // fill setup from the body where the test didn't hand-tag it; a declared setup wins.
        if (sc.setup.length === 0 && inf.setup.length) sc.setup = inf.setup;
    }

    // unreachable: marks a cell N/A — a constraint, not a gap
    const unreachableCell = new Map<string, string>();
    for (const s of ev.scenarios.filter((s) => s.unreachable)) {
        for (const t of s.targets)
            unreachableCell.set(coordKey(t), s.unreachable!);
    }
    ev.scenarios = ev.scenarios.filter((s) => !s.unreachable);

    // cell coverage from mapped scenarios: coord -> scenario names
    const cell = new MultiMap<string>();
    for (const sc of ev.scenarios)
        for (const t of sc.targets) cell.add(coordKey(t), sc.name);

    // proof rows
    const proofRows = INPUT_PROOF_ENUMS.flatMap((enumName) => {
        const e = enums.get(enumName);
        if (!e) return [];
        return e.members.map((member) => {
            const looseFiles = ev.proofRefs.get(member);
            const mapped = ev.scenarios.filter((s) => s.proof === member);
            const status = statusOf(mapped.length, looseFiles.length);
            if (status === "none")
                gaps.push(`[${enumName}] ${member} - no test exercises it`);
            else if (status === "untagged")
                gaps.push(
                    `[${enumName}] ${member} - test(s) exist but none declares an @scenario (describe it)`
                );
            return {
                enum: enumName,
                member,
                looseFiles,
                mapped: mapped.map((s) => s.name),
                status
            };
        });
    });

    // field/class tree
    const structRows = PARTITIONED_STRUCTS.map((structName) => {
        const s = structs.get(structName)!;
        const part = PARTITIONS[structName];
        const fields = s.fields.map((f) => {
            const nested = PARTITIONED_STRUCTS.includes(f.type) ? f.type : null;
            const classes = part[f.name];
            const looseFiles = ev.fieldRefs.get(fieldKey(structName, f.name));
            if (!classes && !nested)
                gaps.push(
                    `[${structName}] field ${f.name} (${f.type}) UNMODELED - add value-classes`
                );
            const classNodes = (classes ?? []).map((cls) => {
                const key = coordKey({
                    struct: structName,
                    field: f.name,
                    cls
                });
                const scs = cell.get(key);
                const naReason = unreachableCell.get(key);
                // an UNREACHABLE class is N/A - a constraint, not a gap.
                if (!naReason && scs.length === 0)
                    gaps.push(
                        `[${structName}] ${f.name}:${cls} - no scenario covers this path`
                    );
                return { cls, scenarios: scs, reachable: !naReason, naReason };
            });
            return {
                name: f.name,
                type: f.type,
                nested,
                looseFiles,
                classes: classNodes,
                modeled: !!classes
            };
        });
        return { name: structName, file: s.file, fields };
    });

    // setup axis: not gap-listed — an untested pre-condition is a candidate, not a debt
    const setupRows = Object.entries(SETUP_FACETS).flatMap(([facet, classes]) =>
        classes.map((cls) => {
            const key = `${facet}:${cls}`;
            const mapped = ev.scenarios
                .filter((s) => s.setup.includes(key))
                .map((s) => s.name);
            return {
                facet,
                cls,
                key,
                status: (mapped.length ? "covered" : "none") as Status,
                mapped
            };
        })
    );

    // interaction gaps: a per-axis chart is 1-way; these are 2-way (proof × condition)
    const setupVals = (s: Scenario, facet: string) =>
        s.setup
            .filter((x) => x.startsWith(facet + ":"))
            .map((x) => x.slice(facet.length + 1));
    const proofsInUse = proofRows
        .map((r) => r.member)
        .filter((m) => ev.scenarios.some((s) => s.proof === m));
    const inUse = new Set(proofsInUse);

    const interactionGaps = (
        table: Record<string, string[][]>,
        facet: string,
        label: string,
        noun: string
    ) => {
        for (const [proof, groups] of Object.entries(table)) {
            if (!inUse.has(proof)) continue; // no test at all -> already a proof-type gap
            const mapped = ev.scenarios.filter((s) => s.proof === proof);
            const vals = new Set(mapped.flatMap((s) => setupVals(s, facet)));
            // nothing tagged anywhere -> the axis isn't tracked for this proof (a test may hit a
            // value but didn't tag it). untagged, not a per-value gap: one note, no false flags.
            if (vals.size === 0) {
                gaps.push(
                    `[${label}] ${proof} - ${mapped.length} test(s) exist but none tags a ${facet}: value (tag them to track ${label} coverage)`
                );
                continue;
            }
            for (const group of groups) {
                if (group.some((c) => vals.has(c))) continue;
                const where = group.map((c) => `'${c}'`).join(" or ");
                gaps.push(
                    `[${label}] ${proof} - no scenario runs it on a ${where} ${noun}`
                );
            }
        }
    };
    interactionGaps(CARRIER_INTERACTION, "proof", "carrier", "state proof");
    interactionGaps(
        CALLDATA_INTERACTION,
        "calldata",
        "calldata",
        "calldata path"
    );

    const allCells = structRows.flatMap((sr) =>
        sr.fields.flatMap((f) => f.classes)
    );
    const reachableCells = allCells.filter((c) => c.reachable);
    const summary = {
        proofsCovered: proofRows.filter((r) => r.status === "covered").length,
        proofsTotal: proofRows.length,
        cellsCovered: reachableCells.filter((c) => c.scenarios.length).length,
        cellsTotal: reachableCells.length,
        naCells: allCells.length - reachableCells.length,
        scenarios: ev.scenarios.length,
        setupCovered: setupRows.filter((r) => r.status === "covered").length,
        setupTotal: setupRows.length
    };

    return {
        enums,
        proofRows,
        structRows,
        setupRows,
        scenarios: ev.scenarios,
        errors: ev.errors,
        gaps,
        summary,
        crossChecks
    };
}

export type Model = ReturnType<typeof buildModel>;
