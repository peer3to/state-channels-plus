// @spec-test-coverage-ignore: isolated real module-loading environments
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export async function runProviderImportCase(
    kind: "missing" | "empty"
): Promise<{ message: string; sameError: boolean }> {
    const directory = await mkdtemp(
        path.join(tmpdir(), "webrtc-provider-test-")
    );
    try {
        await build({
            entryPoints: [
                path.resolve(
                    "src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts"
                )
            ],
            bundle: true,
            platform: "node",
            format: "esm",
            external: ["get-webrtc"],
            outfile: path.join(directory, "provider.mjs")
        });
        if (kind === "empty") {
            const moduleDirectory = path.join(
                directory,
                "node_modules/get-webrtc"
            );
            await mkdir(moduleDirectory, { recursive: true });
            await writeFile(
                path.join(moduleDirectory, "package.json"),
                JSON.stringify({ type: "module", main: "index.js" })
            );
            await writeFile(
                path.join(moduleDirectory, "index.js"),
                "export default {};\n"
            );
        }
        await writeFile(
            path.join(directory, "run.mjs"),
            `
            import { loadWebRTCProvider } from './provider.mjs';
            let directError;
            try { await import('get-webrtc'); } catch (error) { directError = error; }
            try { await loadWebRTCProvider(); throw new Error('Expected unavailable provider'); }
            catch (error) { process.stdout.write(JSON.stringify({ message: error.message, sameError: directError ? error.code === directError.code && error.message.replace('provider.mjs', 'run.mjs') === directError.message : false })); }
        `
        );
        const { stdout } = await promisify(execFile)(process.execPath, [
            path.join(directory, "run.mjs")
        ]);
        return JSON.parse(stdout);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
