// Turn a subsystem scan into gap reports: per-folder GAPS.generated.md
// and the aggregate test/unit/COVERAGE.generated.md.

import type { Matrix } from "../../test/unit/framework/domain";
import type { CellValue, ScannedTest, SubsystemScan } from "./scan";
import { unreachableReason } from "./scan";

interface TestRef {
    title: string;
    file: string;
    line: number;
}

export interface MatrixReport {
    name: string;
    kind: Matrix["kind"];
    desc: string;
    reachable: number;
    covered: { cell: CellValue; tests: TestRef[] }[];
    /** default-option cells covered implicitly (matrix engaged, no explicit tag) */
    implicitDefaults: { cell: CellValue; engagedBy: number }[];
    planned: { cell: CellValue; tests: TestRef[]; blocked: string }[];
    gaps: CellValue[];
    unreachable: { cell: CellValue; reason: string }[];
    /** fields where the default is covered but every deviation is still a gap */
    onlyHappyPath: string[];
}

export interface SubsystemReport {
    folder: string;
    subsystem: string;
    matrices: MatrixReport[];
    errors: string[];
}

// coverage units of a matrix: full tuples (product) or {field: option}
// pairs (variants - fields don't multiply)
function enumerateCells(matrix: Matrix): CellValue[] {
    if (matrix.kind === "variants")
        return Object.entries(matrix.fields).flatMap(([field, options]) =>
            options.map((option) => ({ [field]: option }))
        );
    const axes = Object.entries(matrix.axes);
    let cells: CellValue[] = [{}];
    for (const [axis, options] of axes)
        cells = cells.flatMap((cell) =>
            options.map((opt) => ({ ...cell, [axis]: opt }))
        );
    return cells;
}

// explicit + implicit-default cells both count as covered
function coveredCount(m: MatrixReport): number {
    return m.covered.length + m.implicitDefaults.length;
}

export function cellKey(cell: CellValue): string {
    return Object.keys(cell)
        .sort()
        .map((axis) => `${axis}=${cell[axis]}`)
        .join(" · ");
}

function buildMatrixReport(
    name: string,
    matrix: Matrix,
    tests: ScannedTest[]
): MatrixReport {
    const liveClaims = new Map<string, TestRef[]>();
    const skipClaims = new Map<string, { tests: TestRef[]; blocked: string }>();
    for (const sc of tests) {
        for (const claim of sc.cells) {
            if (claim.matrix !== name) continue;
            const key = cellKey(claim.cell);
            const ref = { title: sc.title, file: sc.file, line: sc.line };
            if (sc.mode === "skip") {
                const entry = skipClaims.get(key) ?? {
                    tests: [],
                    blocked: sc.blocked ?? ""
                };
                entry.tests.push(ref);
                skipClaims.set(key, entry);
            } else {
                liveClaims.set(key, [...(liveClaims.get(key) ?? []), ref]);
            }
        }
    }

    // a matrix is "engaged" once some live test claims any of its cells - such
    // a test ran the matrix's other fields at their declared defaults, so a
    // defaulted option needs no explicit tag to count as covered (the domain
    // declares unmentioned = default; this is not body inference)
    const engagedBy = new Set<string>();
    for (const sc of tests) {
        if (sc.mode === "skip") continue;
        if (sc.cells.some((c) => c.matrix === name))
            engagedBy.add(`${sc.file}:${sc.line}`);
    }
    const defaults: Record<string, string> = {};
    if (matrix.kind === "variants")
        for (const [field, def] of Object.entries(matrix.defaults ?? {}))
            if (def !== undefined) defaults[field] = def;

    const report: MatrixReport = {
        name,
        kind: matrix.kind,
        desc: matrix.desc,
        reachable: 0,
        covered: [],
        implicitDefaults: [],
        planned: [],
        gaps: [],
        unreachable: [],
        onlyHappyPath: []
    };
    for (const cell of enumerateCells(matrix)) {
        const reason = unreachableReason(matrix, cell);
        if (reason) {
            report.unreachable.push({ cell, reason });
            continue;
        }
        report.reachable++;
        const key = cellKey(cell);
        const live = liveClaims.get(key);
        const skip = skipClaims.get(key);
        const [field, option] = Object.entries(cell)[0] ?? [];
        const isDefault = field !== undefined && defaults[field] === option;
        if (live) report.covered.push({ cell, tests: live });
        else if (isDefault && engagedBy.size > 0)
            report.implicitDefaults.push({ cell, engagedBy: engagedBy.size });
        else if (skip) report.planned.push({ cell, ...skip });
        else report.gaps.push(cell);
    }

    // per defaulted field: default covered (explicit or implicit) but every
    // non-default option still a gap = "only the happy path is tested"
    const coveredKeys = new Set([
        ...report.covered.map((c) => cellKey(c.cell)),
        ...report.implicitDefaults.map((d) => cellKey(d.cell))
    ]);
    const gapKeys = new Set(report.gaps.map(cellKey));
    for (const [field, def] of Object.entries(defaults)) {
        if (!coveredKeys.has(cellKey({ [field]: def }))) continue;
        const options = matrix.kind === "variants" ? matrix.fields[field] : [];
        const deviations = options.filter((o) => o !== def);
        if (
            deviations.length > 0 &&
            deviations.every((o) => gapKeys.has(cellKey({ [field]: o })))
        )
            report.onlyHappyPath.push(field);
    }
    return report;
}

export function buildSubsystemReport(scan: SubsystemScan): SubsystemReport {
    const matrices: MatrixReport[] = [];
    const errors = [...scan.errors];
    for (const [name, matrix] of Object.entries(scan.domain.matrices)) {
        try {
            matrices.push(buildMatrixReport(name, matrix, scan.tests));
        } catch (e) {
            errors.push(
                `test/unit/${scan.folder} matrix "${name}": ${(e as Error).message}`
            );
        }
    }
    return {
        folder: scan.folder,
        subsystem: scan.domain.subsystem,
        matrices,
        errors
    };
}

const GENERATED_NOTE =
    "<!-- generated by `yarn coverage:grid` - do not edit -->";

function renderTestRefs(tests: TestRef[]): string {
    return tests.map((t) => `${t.title} (${t.file}:${t.line})`).join(" · ");
}

// variants gaps grouped per field for scanability:
//   - `forkId`: unlinked · cross-fork
function renderGaps(m: MatrixReport): string[] {
    if (m.kind === "product")
        return m.gaps.map((cell) => `- \`${cellKey(cell)}\``);
    const byField = new Map<string, string[]>();
    for (const cell of m.gaps) {
        const [field, option] = Object.entries(cell)[0];
        byField.set(field, [...(byField.get(field) ?? []), option]);
    }
    return [...byField.entries()].map(
        ([field, options]) => `- \`${field}\`: ${options.join(" · ")}`
    );
}

export function renderFolderMd(report: SubsystemReport): string {
    const lines: string[] = [];
    lines.push(`# ${report.subsystem} - coverage gaps`);
    lines.push("");
    lines.push(GENERATED_NOTE);
    lines.push("");
    lines.push(
        "A cell is one variant (`field: option`) of a variants matrix, or one full tuple of a product matrix. Gaps are reachable cells no test claims - the work list. Unreachable cells are constraints of the space, not gaps."
    );
    lines.push("");

    lines.push(
        "| matrix | covered | gaps | planned | unreachable | ⚠ only-happy-path |"
    );
    lines.push("|---|---|---|---|---|---|");
    for (const m of report.matrices)
        lines.push(
            `| ${m.name} | ${coveredCount(m)}/${m.reachable} | ${m.gaps.length} | ${m.planned.length} | ${m.unreachable.length} | ${m.onlyHappyPath.length || ""} |`
        );
    lines.push("");

    for (const m of report.matrices) {
        lines.push(`## ${m.name}`);
        lines.push("");
        lines.push(m.desc);
        lines.push("");
        if (m.onlyHappyPath.length) {
            lines.push(
                `> ⚠ only the happy path is covered for: ${m.onlyHappyPath
                    .map((f) => `\`${f}\``)
                    .join(
                        ", "
                    )} — the default is exercised but no deviation is.`
            );
            lines.push("");
        }
        if (m.gaps.length) {
            lines.push(`### gaps (${m.gaps.length})`);
            lines.push("");
            lines.push(...renderGaps(m));
            lines.push("");
        }
        if (m.planned.length) {
            lines.push(`### planned - blocked (${m.planned.length})`);
            lines.push("");
            for (const p of m.planned)
                lines.push(
                    `- \`${cellKey(p.cell)}\` - blocked: ${p.blocked} - ${renderTestRefs(p.tests)}`
                );
            lines.push("");
        }
        if (m.unreachable.length) {
            lines.push(
                `### unreachable - constraints, not gaps (${m.unreachable.length})`
            );
            lines.push("");
            for (const u of m.unreachable)
                lines.push(`- \`${cellKey(u.cell)}\` - ${u.reason}`);
            lines.push("");
        }
        if (m.implicitDefaults.length) {
            lines.push(
                `### covered implicitly - happy-path default (${m.implicitDefaults.length})`
            );
            lines.push("");
            for (const d of m.implicitDefaults)
                lines.push(
                    `- \`${cellKey(d.cell)}\` <- default, run by ${d.engagedBy} test(s) that engage this matrix`
                );
            lines.push("");
        }
        if (m.covered.length) {
            lines.push(`### covered (${m.covered.length})`);
            lines.push("");
            for (const c of m.covered)
                lines.push(
                    `- \`${cellKey(c.cell)}\` <- ${renderTestRefs(c.tests)}`
                );
            lines.push("");
        }
    }
    return lines.join("\n");
}

export function renderAggregateMd(reports: SubsystemReport[]): string {
    const lines: string[] = [];
    lines.push("# Subsystem coverage");
    lines.push("");
    lines.push(GENERATED_NOTE);
    lines.push("");
    lines.push(
        "One row per matrix of each subsystem domain under `test/unit/`. Per-cell detail lives in each folder's `GAPS.generated.md`. Subsystems from `test/SUBSYSTEMS.md` without a folder here are not tracked yet."
    );
    lines.push("");
    lines.push(
        "| subsystem | matrix | covered | gaps | planned | unreachable | ⚠ only-happy-path |"
    );
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of reports)
        for (const m of r.matrices)
            lines.push(
                `| [${r.subsystem}](${r.folder}/GAPS.generated.md) | ${m.name} | ${coveredCount(m)}/${m.reachable} | ${m.gaps.length} | ${m.planned.length} | ${m.unreachable.length} | ${m.onlyHappyPath.length || ""} |`
            );
    lines.push("");
    return lines.join("\n");
}
