// Shared by discovery, the tier's build warm-up, and the Hardhat task wrapper.
const BROWSER_TEST_TASK = "browser-test";

// Every browser gate is a `run-*.mjs` entry point under test/browser. A gate
// owns its Vite server, its own Hardhat node and its headless Chromium for its
// whole lifetime, which is why one gate is one task. The pattern is rooted at
// test/ like the other tiers', so a shared --test-pattern narrows all three.
const DEFAULT_BROWSER_TEST_PATTERN = "browser/run-*.mjs";

// The same boundary as a rule, applied to every pattern. A custom or shared
// pattern that reaches test/browser otherwise picks up helper modules such as
// sdkRuntimeServer.mjs, and a "gate" that only exports helpers asserts nothing
// while reporting success.
const BROWSER_GATE_FILE_NAME = /^run-.+\.mjs$/;

// The gates load `src` through Vite, so nothing consumes `dist/browser` at run
// time and the tier needs only a typecheck of tsconfig.browser.json, which
// emits nothing. The runner performs it once per run rather than making each
// gate pay for it.
const BROWSER_TYPECHECK_COMMAND = ["yarn", "typecheck:browser"];

module.exports = {
    BROWSER_TEST_TASK,
    DEFAULT_BROWSER_TEST_PATTERN,
    BROWSER_GATE_FILE_NAME,
    BROWSER_TYPECHECK_COMMAND
};
