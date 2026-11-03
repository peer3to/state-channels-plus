// @spec-test-coverage-ignore: script process staging; executable evidence belongs to its calling test declarations
import { repoRoot } from "../../utils/repoRoot";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(repoRoot(), "scripts", "infra", "storage-diff-service.js");
const TSCONFIG = join(repoRoot(), "tsconfig.json");

/** The real `scripts/infra/storage-diff-service.js` in its own process. */
export class ScriptProcess {
    private readonly child: ChildProcess;
    private stdout = "";
    private stderr = "";
    private readonly exit: Promise<{ code: number | null; stderr: string }>;

    private constructor(child: ChildProcess) {
        this.child = child;
        child.stdout?.on("data", (data) => (this.stdout += data.toString()));
        child.stderr?.on("data", (data) => (this.stderr += data.toString()));
        this.exit = new Promise((resolve) =>
            child.once("close", (code) =>
                resolve({ code, stderr: this.stderr })
            )
        );
    }

    static start(args: string[]): ScriptProcess {
        return new ScriptProcess(
            spawn(process.execPath, [SCRIPT, ...args], {
                stdio: ["ignore", "pipe", "pipe"],
                // The test runner's own project would shadow the script's.
                env: { ...process.env, TS_NODE_PROJECT: TSCONFIG }
            })
        );
    }

    /** The URL the script printed once it listens. */
    async listeningUrl(): Promise<string> {
        for (;;) {
            const line = this.stdout
                .split("\n")
                .find((candidate) => candidate.includes('"listening"'));
            if (line) return JSON.parse(line).url;
            const exited = await Promise.race([
                this.exit,
                new Promise<undefined>((resolve) =>
                    setTimeout(() => resolve(undefined), 50)
                )
            ]);
            if (exited) {
                throw new Error(`Script exited early: ${exited.stderr}`);
            }
        }
    }

    exited(): Promise<{ code: number | null; stderr: string }> {
        return this.exit;
    }

    /** Ends the script with SIGINT and waits for its exit. */
    async stop(): Promise<void> {
        this.child.kill("SIGINT");
        await this.exit;
    }
}
