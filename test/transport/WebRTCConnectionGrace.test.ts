import type { WebRTCStateSteps } from "@test/fixtures/customRpc/p2pManagerProbe/P2PManagerProbeService";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

// The setup service's grace for a connection whose path stopped answering is 5 s.
const PAST_GRACE_MS = 5_500;
const WITHIN_GRACE_MS = 4_000;
// The probe waits inside the host.
const PROBE_TIMEOUT_MS = 20_000;

const WAITING = "WebRTC connection disconnected; waiting for it to recover";
const NOT_RECOVERED =
    "WebRTC connection did not recover; closing its transport";
const ENDED = "WebRTC connection ended; closing its transport";

// Chrome reports the ICE change first and the connection state just after it.
const PATH_LOST: WebRTCStateSteps = [
    { connectionState: "connected", iceState: "disconnected" },
    { connectionState: "disconnected", iceState: "disconnected" }
];
const PATH_BACK: WebRTCStateSteps = [
    { connectionState: "disconnected", iceState: "connected" },
    { connectionState: "connected", iceState: "connected" }
];

describe("WebRTC connection grace", function () {
    this.timeout(40_000);
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    function probe(steps: WebRTCStateSteps, waitMs: number, replace?: boolean) {
        return fixture
            .control()
            .p2pManagerProbe.probeWebRTCConnectionStates(
                fixture.address(1),
                steps,
                waitMs,
                replace
            )
            .request({ timeoutMs: PROBE_TIMEOUT_MS });
    }

    it("keeps the transport of a connection whose path recovers within the grace, and logs the loss and the recovery", async function () {
        const result = await probe([...PATH_LOST, ...PATH_BACK], PAST_GRACE_MS);

        expect(result.transportOpen).to.equal(true);
        expect(result.warnings).to.deep.equal([WAITING]);
        expect(result.infos).to.include("WebRTC connection recovered");
    });

    it("keeps the transport open during the grace", async function () {
        const result = await probe(
            [...PATH_LOST, { waitMs: WITHIN_GRACE_MS }],
            0
        );

        expect(result.transportOpen).to.equal(true);
        expect(result.warnings).to.deep.equal([WAITING]);
    });

    it("closes the transport of a connection whose path is still down when the grace ends, with one grace for repeated reports", async function () {
        const result = await probe(
            [
                ...PATH_LOST,
                { connectionState: "disconnected", iceState: "checking" }
            ],
            PAST_GRACE_MS
        );

        expect(result.transportOpen).to.equal(false);
        expect(result.warnings).to.deep.equal([WAITING, NOT_RECOVERED]);
    });

    it("closes the transport and its connection at once when the connection or its path fails or closes, also a DTLS failure on a working path", async function () {
        for (const state of [
            { connectionState: "failed", iceState: "failed" },
            { connectionState: "closed", iceState: "closed" },
            { connectionState: "failed", iceState: "connected" }
        ]) {
            const result = await probe([state], 0);
            const label = `${state.connectionState}/${state.iceState}`;

            expect(result.transportOpen, label).to.equal(false);
            expect(result.warnings, label).to.deep.equal([ENDED]);
            expect(result.factoryCloses, label).to.deep.equal([
                fixture.address(1)
            ]);
        }
    });

    it("closes the transport at once when the connection fails during the grace, and the grace closes nothing more", async function () {
        const result = await probe(
            [...PATH_LOST, { connectionState: "failed", iceState: "failed" }],
            PAST_GRACE_MS
        );

        expect(result.transportOpen).to.equal(false);
        expect(result.warnings).to.deep.equal([WAITING, ENDED]);
    });

    it("ends the grace when the path recovers while the connection state stays disconnected, as in Node", async function () {
        const result = await probe(
            [
                { connectionState: "disconnected", iceState: "disconnected" },
                { connectionState: "disconnected", iceState: "connected" }
            ],
            PAST_GRACE_MS
        );

        expect(result.transportOpen).to.equal(true);
        expect(result.warnings).to.deep.equal([WAITING]);
        expect(result.infos).to.include("WebRTC connection recovered");
    });

    it("gives each path loss its own full grace", async function () {
        const result = await probe(
            [
                ...PATH_LOST,
                { waitMs: 3_000 },
                ...PATH_BACK,
                ...PATH_LOST,
                { waitMs: WITHIN_GRACE_MS }
            ],
            0
        );

        expect(result.transportOpen).to.equal(true);
        expect(result.warnings).to.deep.equal([WAITING, WAITING]);
    });

    it("closes a replaced connection's transport when its replacement starts, without closing the replacement's connection", async function () {
        const result = await probe(PATH_LOST, PAST_GRACE_MS, true);

        expect(result.transportOpen).to.equal(false);
        expect(result.replacementOpen).to.equal(true);
        expect(result.warnings).to.deep.equal([WAITING]);
        expect(result.factoryCloses).to.deep.equal([]);
    });
});
