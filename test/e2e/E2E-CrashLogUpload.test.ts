import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import {
    crashLogConfigOverrides,
    decodeUpload,
    messagesIn,
    startLogReceiver,
    streamsFor,
    uploadsInclude,
    streamsIn,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";

// a port hop plus a POST per realm -> above the fixture's 2s default
const UPLOAD_WAIT_MS = 20_000;

const THREADED = { runSdkInThread: true, vmDedicatedThread: true };
const INLINE = { runSdkInThread: false, vmDedicatedThread: false };

/** one peer's uploads in a round, grouped by thread */
/** the SDK host builds its own logger inside its own thread, so its store needs a
 *  round to reach the server */
describe("E2E: crash log upload", function () {
    let receiver: LogReceiver | undefined;

    beforeEach(async function () {
        receiver = undefined;
        receiver = await startLogReceiver();
    });

    afterEach(async function () {
        const started = receiver;
        receiver = undefined;
        if (started) await started.close();
    });

    // boundary - the SDK host's store -> runtime port -> HTTP
    it("uploads the host thread's own logs, which today never leave it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, THREADED)
        });

        const marker = `host-only-marker-${Date.now()}`;
        await h.execOnHost(
            h.getPeer(0),
            (sm, args: { marker: string }) => {
                sm.logger.warn(args.marker);
                return true;
            },
            { marker }
        );

        const result = await h.logger.uploadLogs("FAILED: host log repro");

        expect(result.timedOut).to.equal(0);
        const sdkStream = streamsFor(receiver!, h.getPeer(0).address).get(
            "sdk"
        );
        expect(sdkStream, "no sdk stream for peer 0").to.not.be.undefined;
        expect(messagesIn(sdkStream!)).to.include(marker);
    });

    // boundary - the whole main <-> sdk <-> vm chain, every peer
    it("uploads one stream per thread for every peer", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, THREADED)
        });

        // vm logs nothing of its own -> without an entry its delta is empty
        for (const peer of h.peers) {
            await h.execOnHost(h.getPeer(peer.index), (sm) => {
                sm.logger.warn("thread stream marker");
                return true;
            });
        }
        // uploads before the channel existed keep the ZeroHash fallback
        const before = receiver!.requests.length;
        await h.logger.uploadLogs("FAILED: per-thread streams");
        const round = receiver!.requests.slice(before);

        for (const peer of h.peers) {
            const streams = streamsIn(round, peer.address);
            expect(
                [...streams.keys()].sort(),
                `peer ${peer.index} streams`
            ).to.include.members(["main", "sdk"]);
            for (const upload of round) {
                expect(upload.channelId).to.equal(String(h.channelId));
            }
        }
    });

    // boundary - worker crash hook -> the bus -> sibling realms
    it("a crash inside the SDK thread uploads every other thread too", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, THREADED)
        });

        const marker = `sdk-thread-crash-${Date.now()}`;
        await h.execOnHost(
            h.getPeer(0),
            (_sm, args: { marker: string }) => {
                void Promise.reject(new Error(args.marker));
                return true;
            },
            { marker }
        );

        // the host funnels it up as a hostError -> claim it, or afterEach rethrows
        await TestSession.expectFirstDetachedError({
            includes: marker,
            timeoutMs: h.event.protocolEventTimeoutMs()
        });
        // the crash round is detached -> wait for the crashed realm's stream
        await waitFor(
            () =>
                uploadsInclude(
                    streamsFor(receiver!, h.getPeer(0).address).get("sdk") ??
                        [],
                    marker
                ),
            UPLOAD_WAIT_MS
        );
        // the round reached the sibling peer's realms, not just the crashed one.
        await waitFor(
            () => streamsFor(receiver!, h.getPeer(1).address).size > 0,
            UPLOAD_WAIT_MS
        );
    });

    // boundary - the delta watermark, carried across the port
    it("a second flush uploads only what happened since the first", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, THREADED)
        });

        await h.logger.uploadLogs("FAILED: first round");
        const firstRound = receiver!.requests.slice();
        expect(firstRound.length).to.be.greaterThan(0);

        await h.transition.advanceState({ count: 1 });
        await h.logger.uploadLogs("FAILED: second round");
        const secondRound = receiver!.requests.slice(firstRound.length);
        expect(secondRound.length).to.be.greaterThan(0);

        const seen = new Set<string>();
        for (const second of secondRound) {
            const key = `${second.peerAddress}/${second.threadName}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const previous = firstRound.filter(
                (upload) =>
                    upload.peerAddress === second.peerAddress &&
                    upload.threadName === second.threadName
            );
            if (previous.length === 0) continue;
            // one seq per entry per store -> disjoint ranges means no overlap
            expect(second.fromSeq, key).to.equal(
                previous[previous.length - 1].toSeq + 1
            );
        }
    });

    // boundary - the round's own outcome, back through the server it uploaded to
    it("uploads a record of what the round reached", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, THREADED)
        });

        const reason = "FAILED: round record";
        const result = await h.logger.uploadLogs(reason);

        const summary = receiver!.requests
            .flatMap(decodeUpload)
            .find((entry) => entry.message === "Log flush round reached");
        expect(summary, "no flush summary entry").to.not.be.undefined;
        expect(summary!.meta[0]).to.deep.equal({ reason, ...result });
        // every realm answered -> nothing is missing from this report
        expect(summary!.meta[0].timedOut).to.equal(0);
        expect(summary!.meta[0].ok).to.be.greaterThan(0);
    });

    // boundary - no ports at all; every realm is this process
    it("inline mode files the same threads without a worker", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            configOverrides: crashLogConfigOverrides(receiver!.url, INLINE)
        });

        const before = receiver!.requests.length;
        const result = await h.logger.uploadLogs("FAILED: inline mode");
        const round = receiver!.requests.slice(before);

        // an inline host has no port -> nothing to time out on
        expect(result.timedOut).to.equal(0);
        for (const peer of h.peers) {
            const streams = streamsIn(round, peer.address);
            expect(
                [...streams.keys()].sort(),
                `peer ${peer.index} streams`
            ).to.include.members(["main", "sdk"]);
        }
        for (const upload of round) {
            expect(upload.channelId).to.equal(String(h.channelId));
        }
    });
});
