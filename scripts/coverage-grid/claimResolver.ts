// Domain-rule layer: validate a scanned test's flat meta against the
// folder's domain and resolve it into coverage units -
//   variants - the (single) matrix owning the field claims each option
//   product  - claimed when ALL its axes are present with valid options
// Every key must claim at least one cell, else error.

import type { Domain, Matrix } from "../../test/unit/framework/domain";
import type { CellValue, ClaimedCell, ScannedTest } from "./testExtractor";

function matchesRule(cell: CellValue, match: Partial<CellValue>): boolean {
    return Object.entries(match).every(([axis, opt]) => cell[axis] === opt);
}

// works for both kinds: a variants coverage unit is a single {field: option}
export function unreachableReason(
    matrix: Matrix,
    cell: CellValue
): string | undefined {
    if (matrix.kind === "product")
        return matrix.unreachable?.find((r) =>
            matchesRule(cell, r.match as Partial<CellValue>)
        )?.reason;
    return matrix.unreachable?.find((r) => cell[r.field as string] === r.option)
        ?.reason;
}

export function fieldsOf(matrix: Matrix): Record<string, readonly string[]> {
    return matrix.kind === "product" ? matrix.axes : matrix.fields;
}

function shortOptions(options: readonly string[]): string {
    const shown = options.slice(0, 6).join(" | ");
    return options.length > 6
        ? `${shown} | … ${options.length - 6} more, see the domain`
        : shown;
}

function resolveFlatMeta(
    domain: Domain,
    sc: ScannedTest,
    where: string,
    errors: string[]
): void {
    const claimedKeys = new Set<string>();
    const units: ClaimedCell[] = [];

    const claim = (matrix: Matrix, name: string, cell: CellValue): void => {
        const reason = unreachableReason(matrix, cell);
        if (reason) {
            errors.push(
                `${where} claims an unreachable ${name} cell (${reason}) - fix the tag or the domain rule`
            );
            return;
        }
        units.push({ matrix: name, cell });
        for (const key of Object.keys(cell)) claimedKeys.add(key);
    };

    for (const [name, matrix] of Object.entries(domain.matrices)) {
        if (matrix.kind === "variants") {
            for (const [field, options] of Object.entries(matrix.fields)) {
                for (const option of sc.pairs[field] ?? [])
                    if (options.includes(option))
                        claim(matrix, name, { [field]: option });
            }
        } else {
            const axes = Object.keys(matrix.axes);
            if (!axes.every((axis) => axis in sc.pairs)) continue;
            const cell: CellValue = {};
            let valid = true;
            for (const axis of axes) {
                const values = sc.pairs[axis];
                if (values.length > 1) {
                    errors.push(
                        `${where} "${axis}" has multiple values but is an axis of the ${name} product - ambiguous tuple`
                    );
                    valid = false;
                    break;
                }
                if (!matrix.axes[axis].includes(values[0])) {
                    valid = false; // not this product's tuple
                    break;
                }
                cell[axis] = values[0];
            }
            if (valid) claim(matrix, name, cell);
        }
    }

    // every key must have claimed something; explain why it didn't
    for (const [key, values] of Object.entries(sc.pairs)) {
        if (claimedKeys.has(key)) continue;
        const hints: string[] = [];
        for (const [name, matrix] of Object.entries(domain.matrices)) {
            const options = fieldsOf(matrix)[key];
            if (!options) continue;
            const bad = values.filter((v) => !options.includes(v));
            if (bad.length)
                hints.push(
                    `${name}.${key} has no option "${bad.join('", "')}" (have: ${shortOptions(options)})`
                );
            else if (matrix.kind === "product")
                hints.push(
                    `the ${name} product also needs: ${Object.keys(matrix.axes)
                        .filter((a) => !(a in sc.pairs))
                        .join(", ")}`
                );
        }
        errors.push(
            hints.length
                ? `${where} "${key}" claimed no cell - ${hints.join("; ")}`
                : `${where} unknown key "${key}" (domain fields: ${[
                      ...new Set(
                          Object.values(domain.matrices).flatMap((m) =>
                              Object.keys(fieldsOf(m))
                          )
                      )
                  ].join(" | ")})`
        );
    }

    sc.cells = units;
}

/** Mode rules + flat-meta resolution for one scanned test. */
export function validateAndResolve(
    domain: Domain,
    sc: ScannedTest,
    errors: string[]
): void {
    const where = `${sc.file}:${sc.line} @${sc.title}`;
    if (sc.mode === "only")
        errors.push(`${where} it.only must not be committed`);
    if (sc.mode === "skip" && !sc.blocked)
        errors.push(
            `${where} it.skip needs a 'blocked:' reason in its covers() meta`
        );
    if (sc.mode !== "skip" && sc.blocked)
        errors.push(`${where} 'blocked:' is only meaningful on it.skip`);
    if (Object.keys(sc.pairs).length === 0)
        errors.push(
            `${where} claims no cells - every test must declare its variant(s)`
        );
    resolveFlatMeta(domain, sc, where, errors);
}
