// @spec-test-coverage-ignore: developer test-orchestration fixture; executable evidence belongs to its calling runner tests
// A throwaway project directory for the compiled-test-tree runner tests: a
// package.json with the given scripts, a tsconfig.json, and source files. Every file is written with a modification time in the past, so a
// stamp written afterwards is newer than all of them; `touch` moves one file
// past the stamp to model a content-only change.
import fs from "fs";
import os from "os";
import path from "path";

const PAST_MS = 60_000;
const FUTURE_MS = 60_000;
const DEFAULT_TSCONFIG = { compilerOptions: { outDir: "dist" } };

export interface CompiledTreeProjectOptions {
    scripts?: Record<string, string>;
    /** An object is written as JSON; a string is written as-is (JSONC). */
    tsconfig?: Record<string, unknown> | string;
    files?: Record<string, string | Buffer>;
}

export class CompiledTreeProject {
    private constructor(readonly root: string) {}

    static create(options: CompiledTreeProjectOptions): CompiledTreeProject {
        const project = new CompiledTreeProject(
            fs.mkdtempSync(path.join(os.tmpdir(), "compiled-tree-"))
        );
        project.write(
            "package.json",
            JSON.stringify({
                name: "compiled-tree-project",
                version: "0.0.0",
                private: true,
                scripts: options.scripts ?? {}
            })
        );
        const tsconfig = options.tsconfig ?? DEFAULT_TSCONFIG;
        project.write(
            "tsconfig.json",
            typeof tsconfig === "string" ? tsconfig : JSON.stringify(tsconfig)
        );
        for (const [file, content] of Object.entries(options.files ?? {})) {
            project.write(file, content);
        }
        return project;
    }

    /** Writes a file (creating its directories) with a past mtime. */
    write(file: string, content: string | Buffer): void {
        const target = this.path(file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        const past = new Date(Date.now() - PAST_MS);
        fs.utimesSync(target, past, past);
    }

    /** Rewrites a file and moves its mtime past any stamp written so far. */
    change(file: string, content: string | Buffer): void {
        this.write(file, content);
        const future = new Date(Date.now() + FUTURE_MS);
        fs.utimesSync(this.path(file), future, future);
    }

    remove(file: string): void {
        fs.rmSync(this.path(file));
    }

    /** Renames a file; its modification time stays as it was. */
    rename(from: string, to: string): void {
        fs.mkdirSync(path.dirname(this.path(to)), { recursive: true });
        fs.renameSync(this.path(from), this.path(to));
    }

    exists(file: string): boolean {
        return fs.existsSync(this.path(file));
    }

    read(file: string): string {
        return fs.readFileSync(this.path(file), "utf8");
    }

    path(file: string): string {
        return path.join(this.root, file);
    }

    dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

/** A package.json script that records it ran by writing `marker`. */
export function markerScript(marker: string): string {
    return `node -e "require('fs').writeFileSync('${marker}', '1')"`;
}

/** A package.json script that exits non-zero without writing anything. */
export const FAILING_SCRIPT = `node -e "process.exit(3)"`;

/** A package.json script that compiles the project with the real tsc. */
export function tscScript(): string {
    return `node "${require.resolve("typescript/bin/tsc")}" -p tsconfig.json`;
}
