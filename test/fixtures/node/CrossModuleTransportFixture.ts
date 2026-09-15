// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { withWebRTCBridge } from "./WebRTCBridgeFixture";
import { isTransport } from "@/transport/ATransport";
import NetworkTransport, {
    isNetworkTransport
} from "@/transport/NetworkTransport";
import WebRTCTransport from "@/transport/WebRTCTransport";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

/** Loads the real transport classes with a separate module cache. */
function loadSeparateTransportGraph(): typeof WebRTCTransport {
    // Absolute source module paths index the isolated transport graph.
    const modules = new Map<string, { exports: Record<string, unknown> }>();
    const load = (filename: string): Record<string, unknown> => {
        const cached = modules.get(filename);
        if (cached) return cached.exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const localRequire = createRequire(filename);
        const requireFromGraph = (specifier: string) => {
            if (
                specifier === "./NetworkTransport" ||
                specifier === "./ATransport"
            ) {
                return load(
                    path.resolve(path.dirname(filename), `${specifier}.ts`)
                );
            }
            return localRequire(specifier);
        };
        const output = ts.transpileModule(readFileSync(filename, "utf8"), {
            compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                esModuleInterop: true
            }
        }).outputText;
        new Function("require", "module", "exports", output)(
            requireFromGraph,
            module,
            module.exports
        );
        return module.exports;
    };
    return load(require.resolve("@/transport/WebRTCTransport"))
        .default as typeof WebRTCTransport;
}

export async function assertFreshCrossModuleNetworkTransport(): Promise<void> {
    await withWebRTCBridge(async (bridge) => {
        const connected = await bridge.negotiate();
        const SeparateWebRTCTransport = loadSeparateTransportGraph();
        const transport = new SeparateWebRTCTransport(
            connected.channel,
            bridge.manager.rpcRouter
        );
        try {
            expect(transport instanceof NetworkTransport).to.equal(false);
            expect("peerAddress" in transport).to.equal(true);
            expect(transport.peerAddress).to.equal(undefined);
            expect(isTransport(transport)).to.equal(true);
            expect(isNetworkTransport(transport)).to.equal(true);
        } finally {
            transport.close(true);
        }
    });
}
