import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// When consuming the SDK from this monorepo via pnpm link, the built output lives here.
// The SDK’s emitted JS uses tsconfig path aliases like "@/" and "@typechain-types".
// Vite needs explicit aliases to resolve those during dependency pre-bundling.
const sdkDistSrc = path.resolve(__dirname, "../../../dist/src");
const sdkDistTypechain = path.resolve(
    __dirname,
    "../../../dist/typechain-types"
);
const rootEthers = path.resolve(__dirname, "../../../node_modules/ethers");

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        // This app consumes the SDK via a monorepo link ("link:../../.."), which means
        // Rollup may see the SDK's CommonJS output as files outside node_modules.
        // Preserve symlinks and explicitly include the SDK dist output in CommonJS handling
        // so named exports (e.g. ARpcMethods) work in production builds.
        preserveSymlinks: true,
        alias: {
            "@": sdkDistSrc,
            "@typechain-types": sdkDistTypechain,
            ethers: rootEthers
        }
    },
    optimizeDeps: {
        include: ["@peer3/state-channels-plus"]
    },
    build: {
        sourcemap: true,
        commonjsOptions: {
            include: [/node_modules/, /state-channels-plus\/dist\/.*\.js$/]
        }
    }
});
