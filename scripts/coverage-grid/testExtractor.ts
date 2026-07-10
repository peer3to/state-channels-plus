// AST extraction: pull the covers() metas out of a test file's native
// mocha its. Pure and domain-unaware - validation against the domain
// happens in claimResolver.ts.
//
// No inference: a test is linked to cells ONLY by its literal meta.
// Every it() in a subsystem folder must wrap its body in covers() - an untagged test is an error.

import * as fs from "fs";
import * as ts from "typescript";

// reserved meta key (it.skip reason) - not a valid field name
export const BLOCKED_KEY = "blocked";

// one coverage unit: a full tuple (product matrix) or a single
// { field: option } pair (variants matrix)
export type CellValue = Record<string, string>;

export interface ClaimedCell {
    matrix: string;
    cell: CellValue;
}

export interface ScannedTest {
    title: string;
    file: string; // repo-relative
    line: number;
    mode: "live" | "skip" | "only";
    blocked?: string;
    /** the flat meta: key -> option(s) */
    pairs: Record<string, string[]>;
    /** resolved coverage units (filled by claimResolver) */
    cells: ClaimedCell[];
}

class NonLiteralError extends Error {
    constructor(node: ts.Node, sf: ts.SourceFile) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        super(`non-literal meta at line ${line + 1}: \`${node.getText(sf)}\``);
    }
}

// strictly-literal object evaluation
function evalLiteral(node: ts.Expression, sf: ts.SourceFile): unknown {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node))
        return node.elements.map((e) => evalLiteral(e, sf));
    if (ts.isObjectLiteralExpression(node)) {
        const out: Record<string, unknown> = {};
        for (const p of node.properties) {
            if (!ts.isPropertyAssignment(p)) throw new NonLiteralError(p, sf);
            if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name))
                throw new NonLiteralError(p, sf);
            out[p.name.text] = evalLiteral(p.initializer, sf);
        }
        return out;
    }
    throw new NonLiteralError(node, sf);
}

// it / it.skip / it.only
function itMode(node: ts.CallExpression): ScannedTest["mode"] | null {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === "it") return "live";
    if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "it" &&
        (callee.name.text === "skip" || callee.name.text === "only")
    )
        return callee.name.text as "skip" | "only";
    return null;
}

function asCoversCall(
    node: ts.Expression | undefined
): ts.CallExpression | null {
    return node &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "covers"
        ? node
        : null;
}

function toScannedTest(
    title: string,
    file: string,
    line: number,
    mode: ScannedTest["mode"],
    meta: Record<string, unknown>
): ScannedTest {
    const pairs: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(meta)) {
        if (key === BLOCKED_KEY) continue;
        pairs[key] = (Array.isArray(value) ? value : [value]).map(String);
    }
    return {
        title,
        file,
        line,
        mode,
        blocked:
            typeof meta[BLOCKED_KEY] === "string"
                ? (meta[BLOCKED_KEY] as string)
                : undefined,
        pairs,
        cells: []
    };
}

/** Extract every tagged test from `file` (repo-relative name `rel`). */
export function extractTests(
    file: string,
    rel: string,
    tests: ScannedTest[],
    errors: string[]
): void {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
    );

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const mode = itMode(node);
            if (mode) {
                const { line } = sf.getLineAndCharacterOfPosition(
                    node.getStart(sf)
                );
                const where = `${rel}:${line + 1}`;
                const [titleArg, bodyArg] = node.arguments;
                const title =
                    titleArg && ts.isStringLiteralLike(titleArg)
                        ? titleArg.text
                        : null;
                const coversCall = asCoversCall(bodyArg);
                if (title === null) {
                    errors.push(`${where} it() title must be a string literal`);
                } else if (!coversCall) {
                    errors.push(
                        `${where} @${title} untagged test - wrap the body in covers({...}, fn) from this folder's domain`
                    );
                } else if (
                    !coversCall.arguments[0] ||
                    !ts.isObjectLiteralExpression(coversCall.arguments[0])
                ) {
                    errors.push(
                        `${where} @${title} covers() meta must be an object literal (no variables, spreads, or calls)`
                    );
                } else {
                    try {
                        const meta = evalLiteral(
                            coversCall.arguments[0],
                            sf
                        ) as Record<string, unknown>;
                        tests.push(
                            toScannedTest(title, rel, line + 1, mode, meta)
                        );
                    } catch (e) {
                        errors.push(
                            `${where} @${title} ${(e as Error).message}`
                        );
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}
