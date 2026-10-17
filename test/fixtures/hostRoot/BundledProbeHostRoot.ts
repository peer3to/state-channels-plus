// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ProbeHostRoot } from "./ProbeHostRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import { resolveRuntimeModulePath } from "@/utils/moduleLoader/node/resolveRuntimeModulePath";
import { build, type Plugin } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * The modules the bundle carries its own copies of: the probe root, the SDK
 * host root it extends and the config module they read; their `.js` twins
 * when the compiled tree runs.
 */
const OWN_COPIES = [
    path.join(__dirname, "ProbeHostRoot.ts"),
    path.join(__dirname, "probe/HostProbeService.ts"),
    path.join(__dirname, "probe/HostProbeRpcMethods.ts"),
    path.join(REPO_ROOT, "src/rpc/internal/roots/P2pRuntimeHostRoot.ts"),
    path.join(REPO_ROOT, "src/utils/config.ts")
].map(resolveRuntimeModulePath);

/**
 * Every other import stays external in the shared graph, by the absolute
 * path `require` resolves from the importing module, so the bundle loads the
 * very modules the worker entry loaded.
 */
const shareOtherModules: Plugin = {
    name: "share-other-modules",
    setup(bundler) {
        bundler.onResolve({ filter: /.*/ }, async (args) => {
            if (args.kind === "entry-point" || args.pluginData?.isNested)
                return undefined;
            const resolved = await bundler.resolve(args.path, {
                resolveDir: args.resolveDir,
                kind: args.kind,
                pluginData: { isNested: true }
            });
            if (resolved.errors.length > 0) return { errors: resolved.errors };
            if (OWN_COPIES.includes(resolved.path))
                return { path: resolved.path };
            // A package resolves to its CommonJS entry, as `require` loads it.
            const isPackage = resolved.path.includes(
                `${path.sep}node_modules${path.sep}`
            );
            return {
                path: isPackage
                    ? require.resolve(args.path, { paths: [args.resolveDir] })
                    : resolved.path,
                external: true
            };
        });
    }
};

/**
 * The probe host root compiled into its own module, as an application
 * bundles it apart from the SDK worker entry: it has its own copy of the
 * config module. Delete the bundle with `dispose`.
 */
export async function bundleProbeHostRoot(): Promise<{
    manifest: HostRootManifest<ProbeHostRoot>;
    dispose: () => Promise<void>;
}> {
    const directory = await mkdtemp(path.join(tmpdir(), "probe-host-root-"));
    const outfile = path.join(directory, "ProbeHostRoot.js");
    try {
        await build({
            entryPoints: [OWN_COPIES[0]],
            bundle: true,
            platform: "node",
            format: "cjs",
            plugins: [shareOtherModules],
            outfile,
            logLevel: "silent"
        });
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
    return {
        manifest: { module: outfile, exportName: "ProbeHostRoot" },
        dispose: () => rm(directory, { recursive: true, force: true })
    };
}
