import {
    loadBrowserTestDependency,
    startBrowserGateServer
} from "./browserGateServer.mjs";
import { launchChromium } from "./chromiumLaunch.js";
import assert from "node:assert/strict";
import { test } from "node:test";

// Playwright's own default: module load waits for Vite to transpile the
// storage sources in the page.
const PAGE_TIMEOUT_MS = 60_000;

const { chromium } = await loadBrowserTestDependency("playwright");

const { origin, server } = await startBrowserGateServer({
    cacheName: "run-persistence-restart",
    page: "test/browser/persistence-restart.html"
});

let browser;
try {
    browser = await launchChromium(chromium);
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error));
    page.on("console", (message) => {
        if (message.type() === "error")
            browserErrors.push(new Error(message.text()));
    });

    await page.goto(`${origin}/test/browser/persistence-restart.html`);
    await page.waitForFunction(() => globalThis.persistenceRestartReady);

    await test("browser persistence partition recovers its signer and flushed records across reopen", async () => {
        const result = await page.evaluate(() =>
            globalThis.runPersistenceRestartBrowserSmoke()
        );

        assert.deepEqual(result, {
            leaseRejected: true,
            signerRecovered: true,
            explicitFlushRecovered: true,
            timedFlushPersisted: true,
            forceExitRecovered: true
        });
        assert.equal(browserErrors.length, 0, browserErrors[0]?.stack);
    });
} finally {
    await browser?.close();
    await server.close();
}
