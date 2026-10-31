// @spec-test-coverage-ignore: shared driver of the transport permutation gates; evidence is mapped from run-transport-*-e2e.mjs
import {
    loadBrowserTestDependency,
    startBrowserGateServer
} from "./browserGateServer.mjs";
import { launchChromium } from "./chromiumLaunch.js";
import { startLocalDiscoveryRelayHub } from "./localDiscoveryRelayHub.mjs";
import { startLocalHolepunch } from "./localHolepunch.js";
import { startSdkRuntimeServer } from "./sdkRuntimeServer.mjs";
import { ethers } from "ethers";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Must match sdkSetup.js: the windows below are counted in agreement windows.
const AGREEMENT_MS = 30_000;
const HOLEPUNCH = 0;
const WEBRTC = 1;
const SYNCED = 3;
const PARTICIPATING = 5;
const SAMPLE_MS = 500;
const LOG_TAIL_LINES = 300;
// The blacklisted peer's pending link answers its handshake within one
// agreement window, so the window it stays unlinked must end before that.
const BAN_WINDOW_MS = 10_000;

/**
 * Two browser peers, each in its own page, over one bootstrap transport:
 * `local` (the local discovery relay hub) or `holepunch` (real Hyperswarm
 * through dht-relay on a private DHT). The permutations:
 *  (a) the pages match through the lobby and author blocks for three
 *      agreement windows;
 *  (b) after the upgrade grace every open connection is WebRTC and stays so;
 *  (c) a dropped WebRTC connection falls back to the bootstrap transport
 *      within one agreement window, and blocks keep flowing;
 *  (d, e) three pages select one opened channel by connectToChannel (no
 *      lobby) and all three connect pairwise;
 *  (f) local only: a blacklisted peer that the hub announces again is not
 *      linked, and releasing the blacklist links it exactly once;
 *  (g) local only: a link socket that opens after its runtime was disposed
 *      is closed without a transport, so the disposed page logs no error.
 */
export async function runTransportPermutations(mode) {
    const resources = [];
    const pages = [];
    try {
        // Chain fallback runs on the chain clock: it must track the wall clock.
        const runtimeServer = await startSdkRuntimeServer({
            miningIntervalMs: 1_000
        });
        resources.push(() => runtimeServer.close());
        let relayUrls;
        let hub;
        if (mode === "local") {
            hub = await startLocalDiscoveryRelayHub();
            resources.push(() => hub.close());
            relayUrls = [hub.url];
        } else {
            const holepunch = await startLocalHolepunch();
            resources.push(() => holepunch.close());
            relayUrls = holepunch.relayUrls;
        }
        const { chromium } = await loadBrowserTestDependency("playwright");
        const { origin, server } = await startBrowserGateServer({
            cacheName: `run-transport-${mode}-e2e`,
            rpcProxy: runtimeServer.proxy,
            page: "test/browser/transport-permutations.html"
        });
        resources.push(() => server.close());
        const browser = await launchChromium(chromium);
        resources.push(() => browser.close());

        const openPage = async (name) => {
            // A context per page: separate browsers, not tabs of one.
            const context = await browser.newContext();
            const page = await context.newPage();
            const handle = { name, page, log: [], errors: [] };
            pages.push(handle);
            const record = (message) => {
                handle.log.push(`[${message.type()}] ${message.text()}`);
                if (message.type() === "error")
                    handle.errors.push(message.text());
            };
            // Includes the console of the page's workers.
            page.on("console", record);
            page.on("pageerror", (error) =>
                handle.errors.push(error.stack || error.message)
            );
            await page.addInitScript(
                (config) => {
                    globalThis.__TRANSPORT_E2E__ = config;
                },
                {
                    mode,
                    providerUrl: `${origin}/rpc`,
                    // Peers spread over the relays, as clients of a real network.
                    relayUrl: relayUrls[(pages.length - 1) % relayUrls.length],
                    logLevel: process.env.LOG_LEVEL || "info"
                }
            );
            await page.goto(
                `${origin}/test/browser/transport-permutations.html`
            );
            await page.waitForFunction(
                () => Boolean(globalThis.__transportE2E),
                null,
                {
                    timeout: 60_000
                }
            );
            handle.call = (method, arg) =>
                page.evaluate(
                    ([name, value]) => globalThis.__transportE2E[name](value),
                    [method, arg]
                );
            handle.close = async () => {
                await handle.call("dispose").catch(() => {});
                await context.close();
            };
            return handle;
        };

        const results = {};
        const lobbyPages = [
            await openPage("lobby-1"),
            await openPage("lobby-2")
        ];
        const { scmAddress } = await lobbyPages[0].call("deploy");
        results.lobby = await runLobbyPermutations(
            mode,
            lobbyPages,
            scmAddress
        );
        for (const page of lobbyPages) await page.close();

        const directPages = [
            await openPage("direct-a"),
            await openPage("direct-b"),
            await openPage("direct-observer")
        ];
        results.direct = await runDirectPermutations(
            mode,
            directPages,
            scmAddress
        );
        for (const page of directPages) await page.close();

        if (mode === "local") {
            const banPages = [await openPage("ban-a"), await openPage("ban-b")];
            results.ban = await runBanPermutation(
                mode,
                banPages,
                scmAddress,
                hub
            );
            for (const page of banPages) await page.close();

            const latePages = [
                await openPage("late-link-a"),
                await openPage("late-link-b")
            ];
            results.lateLink = await runLateLinkPermutation(
                mode,
                latePages,
                scmAddress,
                hub
            );
            for (const page of latePages) await page.close();
        }

        console.log(
            `Transport permutations (${mode}):`,
            JSON.stringify(results)
        );
        for (const page of pages)
            assert.deepEqual(page.errors, [], `${page.name} logged errors`);
    } catch (error) {
        console.error(`Transport permutations (${mode}) FAILED\n`);
        for (const page of pages) {
            console.error(
                `--- ${page.name} console tail (${page.log.length} lines) ---`
            );
            console.error(page.log.slice(-LOG_TAIL_LINES).join("\n"));
            if (page.errors.length)
                console.error(
                    `--- ${page.name} errors ---\n${page.errors.join("\n")}`
                );
        }
        throw error;
    } finally {
        // TRANSPORT_E2E_LOG_DIR keeps every page's full console.
        const logDir = process.env.TRANSPORT_E2E_LOG_DIR;
        if (logDir) {
            await fs.mkdir(logDir, { recursive: true });
            for (const page of pages)
                await fs.writeFile(
                    path.join(logDir, `${mode}-${page.name}.log`),
                    page.log.join("\n")
                );
        }
        for (const close of resources.reverse())
            await Promise.resolve(close()).catch(() => {});
    }
}

async function runLobbyPermutations(mode, pages, scmAddress) {
    const addresses = await Promise.all(
        pages.map((page, index) =>
            page.call("start", { scmAddress, walletIndex: 1 + index })
        )
    );
    const topic = ethers.id(`transport-${mode}-lobby`);
    const matches = await withDeadline(
        Promise.all(pages.map((page) => page.call("joinLobby", topic))),
        4 * AGREEMENT_MS,
        "(a) lobby match"
    );
    assert.equal(matches[0].channelId, matches[1].channelId);
    assert.equal(
        ethers.getAddress(matches[0].peerAddress),
        ethers.getAddress(addresses[1])
    );
    await waitFor(
        pages,
        (states) => states.every(({ status }) => status === PARTICIPATING),
        2 * AGREEMENT_MS,
        "(a) both pages participate"
    );
    const startedAt = Date.now();

    // (b) The upgrade's grace retires the bootstrap transport.
    const upgraded = await waitFor(
        pages,
        (states) => states.every((state) => isOnly(state, [WEBRTC])),
        2 * AGREEMENT_MS,
        "(b) only WebRTC connections after the upgrade grace"
    );
    const webRtcOnlyAfterMs = Date.now() - startedAt;

    // (a, b) Blocks flow for three agreement windows, over WebRTC only.
    const playFrom = upgraded.map(({ finalized }) => finalized);
    const samples = await observe(pages, startedAt + 3 * AGREEMENT_MS);
    const leak = samples.find((states) =>
        states.some((state) => !isOnly(state, [WEBRTC]))
    );
    assert.equal(
        leak,
        undefined,
        `(b) a non-WebRTC connection reappeared: ${JSON.stringify(leak)}`
    );
    const played = samples.at(-1);
    const blocksPlayed = played.map(
        ({ finalized }, index) => finalized - playFrom[index]
    );
    assert.ok(
        blocksPlayed.every((count) => count >= 3),
        `(a) blocks finalized per page over the play window: ${blocksPlayed}`
    );

    // (c) A dropped WebRTC path falls back to the bootstrap transport.
    const closedConnections = await pages[0].call("closeWebRtc");
    assert.ok(closedConnections > 0, "(c) no WebRTC connection to close");
    const closedAt = Date.now();
    const fallback = await waitFor(
        pages,
        (states) =>
            states.every((state) =>
                state.connections.some(
                    ({ transportType }) => transportType === HOLEPUNCH
                )
            ),
        AGREEMENT_MS,
        "(c) bootstrap fallback after the WebRTC close"
    );
    const fallbackAfterMs = Date.now() - closedAt;
    const resumed = await waitFor(
        pages,
        (states) =>
            states.every(
                ({ finalized }, index) =>
                    finalized >= fallback[index].finalized + 3
            ),
        2 * AGREEMENT_MS,
        "(c) blocks flow after the fallback"
    );
    return {
        webRtcOnlyAfterMs,
        blocksPlayed,
        fallbackAfterMs,
        blocksAfterFallback: resumed.map(
            ({ finalized }, index) => finalized - fallback[index].finalized
        ),
        connectionsAfterFallback: resumed.map(({ connections }) =>
            connections.map(({ transportType }) => transportType)
        ),
        disconnections: resumed.map(({ disconnections }) => disconnections)
    };
}

async function runDirectPermutations(mode, pages, scmAddress) {
    const [participantA, participantB, observer] = pages;
    const addresses = await Promise.all(
        pages.map((page, index) =>
            page.call("start", { scmAddress, walletIndex: 3 + index })
        )
    );
    const channelId = ethers.id(`transport-${mode}-direct`);
    // The genesis runtime selects the channel before it opens, so its chain
    // listener applies genesis and it can serve the others.
    assert.equal(await participantA.call("connectToChannel", channelId), false);
    await participantA.call("openChannel", {
        scmAddress,
        channelId,
        participantIndices: [3, 4]
    });
    await waitFor(
        [participantA],
        ([state]) => state.status === PARTICIPATING,
        2 * AGREEMENT_MS,
        "(e) genesis participant applies the opening"
    );
    // The other participant and the observer connect together, while both
    // participants may still be syncing.
    const connected = await withDeadline(
        Promise.all(
            pages.map((page) => page.call("connectToChannel", channelId))
        ),
        4 * AGREEMENT_MS,
        "(e) connectToChannel"
    );
    assert.deepEqual(connected, [true, true, true]);
    const meshed = await waitFor(
        pages,
        (states) =>
            states.every((state, index) =>
                addresses.every(
                    (address, other) =>
                        other === index ||
                        state.connections.some(
                            ({ peerAddress }) =>
                                ethers.getAddress(peerAddress) ===
                                ethers.getAddress(address)
                        )
                )
            ),
        2 * AGREEMENT_MS,
        "(d) three peers connect pairwise"
    );
    const played = await waitFor(
        pages,
        (states) =>
            states[0].finalized >= meshed[0].finalized + 3 &&
            states[1].finalized >= meshed[1].finalized + 3,
        2 * AGREEMENT_MS,
        "(e) participants finalize blocks"
    );
    assert.equal(played[2].status, SYNCED);
    return {
        statuses: played.map(({ status }) => status),
        connections: played.map(({ connections }) =>
            connections.map(({ transportType }) => transportType)
        )
    };
}

/**
 * (f) Page A blacklists page B, and B joins the channel topic again, so the
 * hub announces B to A. A must not link B: no connection and no hub pair
 * between them for a bounded window. Releasing the blacklist links them
 * through exactly one new hub pair and one bootstrap connection per page.
 */
async function runBanPermutation(mode, pages, scmAddress, hub) {
    const [banning, banned] = pages;
    // Inline runtimes: the ban hooks act on the page's own P2PManager.
    const addresses = await Promise.all(
        pages.map((page, index) =>
            page.call("start", {
                scmAddress,
                walletIndex: 6 + index,
                inline: true
            })
        )
    );
    const [banningAddress, bannedAddress] = addresses;
    const linkId = addresses
        .map((address) => address.toLowerCase())
        .sort()
        .join(":");
    const toPeer = (state, peer) =>
        state.connections.filter(
            ({ peerAddress }) =>
                ethers.getAddress(peerAddress) === ethers.getAddress(peer)
        );
    const areLinked = ([a, b]) =>
        toPeer(a, bannedAddress).length > 0 &&
        toPeer(b, banningAddress).length > 0;
    const areUnlinked = ([a, b]) =>
        toPeer(a, bannedAddress).length === 0 &&
        toPeer(b, banningAddress).length === 0;

    const topic = ethers.id(`transport-${mode}-ban`);
    const matches = await withDeadline(
        Promise.all(pages.map((page) => page.call("joinLobby", topic))),
        4 * AGREEMENT_MS,
        "(f) lobby match"
    );
    const { channelId } = matches[0];
    await waitFor(
        pages,
        (states) =>
            areLinked(states) &&
            states.every(({ status }) => status === PARTICIPATING),
        2 * AGREEMENT_MS,
        "(f) both pages participate and connect"
    );

    await banning.call("blacklist", bannedAddress);
    await waitFor(
        pages,
        areUnlinked,
        AGREEMENT_MS,
        "(f) the blacklist drops the link"
    );
    const pairsBefore = hub.pairings(linkId);
    await banned.call("rejoinChannelTopic", channelId);
    const samples = await observe(pages, Date.now() + BAN_WINDOW_MS);
    const leak = samples.find((states) => !areUnlinked(states));
    assert.equal(
        leak,
        undefined,
        `(f) the blacklisted peer connected: ${JSON.stringify(leak)}`
    );
    assert.equal(
        hub.pairings(linkId),
        pairsBefore,
        "(f) the hub paired a link to the blacklisted peer"
    );

    assert.equal(await banning.call("unblacklist", bannedAddress), true);
    const relinked = await waitFor(
        pages,
        areLinked,
        AGREEMENT_MS,
        "(f) the release links the peer"
    );
    assert.equal(
        hub.pairings(linkId),
        pairsBefore + 1,
        "(f) the release forms exactly one hub pair"
    );
    const bootstrapLinks = [
        toPeer(relinked[0], bannedAddress),
        toPeer(relinked[1], banningAddress)
    ].map(
        (connections) =>
            connections.filter(
                ({ transportType }) => transportType === HOLEPUNCH
            ).length
    );
    assert.deepEqual(
        bootstrapLinks,
        [1, 1],
        `(f) one bootstrap connection per page: ${JSON.stringify(relinked)}`
    );
    return { unlinkedSamples: samples.length, bootstrapLinks };
}

/**
 * (g) The hub holds every link socket while both pages join one lobby topic,
 * so each page has a link to the other still connecting. Page A disposes its
 * runtime, then the hub lets the sockets open: A's link opens after its
 * runtime is gone and must be closed without a transport (any error A logs
 * fails the gate).
 */
async function runLateLinkPermutation(mode, pages, scmAddress, hub) {
    const [disposed, other] = pages;
    // Inline runtimes: disposing a worker runtime ends its worker, so a late
    // socket event could never run there.
    const addresses = await Promise.all(
        pages.map((page, index) =>
            page.call("start", {
                scmAddress,
                walletIndex: 8 + index,
                inline: true
            })
        )
    );
    const linkId = addresses
        .map((address) => address.toLowerCase())
        .sort()
        .join(":");
    hub.holdLinks();
    const topic = ethers.id(`transport-${mode}-late-link`);
    // The lobby never matches: page A is disposed while it waits.
    for (const page of pages) page.call("joinLobby", topic).catch(() => {});
    await waitUntil(
        () => hub.heldLinks() === 2,
        AGREEMENT_MS,
        "(g) both link sockets held at the hub"
    );

    await disposed.call("dispose");
    hub.releaseLinks();
    await waitUntil(
        () => hub.linkCloses(linkId) > 0,
        AGREEMENT_MS,
        "(g) the disposed page closes its late link"
    );
    await other.call("dispose");
    return { linkCloses: hub.linkCloses(linkId) };
}

/** Polls `isMet` until it holds; throws `label` after `timeoutMs`. */
async function waitUntil(isMet, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (!isMet()) {
        if (Date.now() > deadline) throw new Error(`${label} timed out`);
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
    }
}

function isOnly(state, transportTypes) {
    return (
        state.connections.length > 0 &&
        state.connections.every(({ transportType }) =>
            transportTypes.includes(transportType)
        )
    );
}

function sample(pages) {
    return Promise.all(pages.map((page) => page.call("state")));
}

/** Polls the pages until `predicate` holds; returns that sample. */
async function waitFor(pages, predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const states = await sample(pages);
        if (predicate(states)) return states;
        if (Date.now() > deadline)
            throw new Error(
                `${label} timed out after ${timeoutMs} ms: ${JSON.stringify(states)}`
            );
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
    }
}

/** Samples the pages until `until`; returns every sample. */
async function observe(pages, until) {
    const samples = [];
    do {
        samples.push(await sample(pages));
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
    } while (Date.now() < until);
    return samples;
}

async function withDeadline(promise, timeoutMs, label) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `${label} timed out after ${timeoutMs} ms`
                            )
                        ),
                    timeoutMs
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}
