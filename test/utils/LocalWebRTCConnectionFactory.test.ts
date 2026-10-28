import { STATS_READ_TIME_LIMIT_MS } from "@/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory";
import {
    FIREFOX_SELECTED_PATH,
    NO_SELECTED_PATH,
    SELECTED_PAIR_STATS,
    SELECTED_PATH,
    openConnection,
    statsHold
} from "@test/fixtures/LocalWebRTCConnectionFactoryFixture";
import { recordUnhandledRejections } from "@test/fixtures/UnhandledRejectionRecorder";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import sinon from "sinon";

describe("LocalWebRTCConnectionFactory state reports", function () {
    it("reports each state change with its selected path's stats, in the order of the changes, also when the first stats read is slow", async function () {
        const { connection, states, errors } = await openConnection(true);
        connection.statsReport = SELECTED_PATH;
        const first = statsHold();
        connection.statsHolds.push(first.hold);

        connection.changeState("disconnected", "disconnected");
        connection.changeState("connected", "connected");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(states).to.deep.equal([]);
        first.release();
        await waitFor(() => states.length === 4, 5_000, 5);

        expect(
            states.map((state) => `${state.connectionState}/${state.iceState}`)
        ).to.deep.equal([
            "new/disconnected",
            "disconnected/disconnected",
            "disconnected/connected",
            "connected/connected"
        ]);
        expect(states[1].path).to.deep.equal({
            dtlsState: "connected",
            selectedPairChanges: 1,
            ...SELECTED_PAIR_STATS
        });
        expect(errors).to.deep.equal([]);
    });

    it("reports an ICE change that comes without a connection-state change, as werift reports a recovered path", async function () {
        const { connection, states } = await openConnection(false);

        connection.changeState("disconnected", "disconnected");
        connection.changeIceState("connected");
        await waitFor(() => states.length === 3, 5_000, 5);

        expect(
            states.map((state) => `${state.connectionState}/${state.iceState}`)
        ).to.deep.equal([
            "new/disconnected",
            "disconnected/disconnected",
            "disconnected/connected"
        ]);
    });

    it("reports state changes without path stats where the runtime has no getStats", async function () {
        const { connection, states, errors } = await openConnection(false);

        connection.changeState("connected", "connected");
        await waitFor(() => states.length === 2, 5_000, 5);

        expect(states).to.deep.equal([
            { connectionState: "new", iceState: "connected", path: undefined },
            {
                connectionState: "connected",
                iceState: "connected",
                path: undefined
            }
        ]);
        expect(errors).to.deep.equal([]);
    });

    it("reports a state change whose stats read fails, without path stats, and reports the failure", async function () {
        const { connection, states, errors } = await openConnection(true);
        connection.statsError = new Error("stats unavailable");

        connection.changeState("failed", "failed");
        await waitFor(() => states.length === 2, 5_000, 5);

        expect(states.map((state) => state.connectionState)).to.deep.equal([
            "new",
            "failed"
        ]);
        expect(states.map((state) => state.path)).to.deep.equal([
            undefined,
            undefined
        ]);
        expect(errors.map((error) => error.message)).to.deep.equal([
            "stats unavailable",
            "stats unavailable"
        ]);
    });

    it("reports a state change whose stats read never settles after the time limit, without path stats, and still reports the later changes", async function () {
        const { connection, states, errors } = await openConnection(true);
        const clock = sinon.useFakeTimers();
        try {
            connection.statsReport = SELECTED_PATH;
            connection.statsHolds.push(statsHold().hold);

            connection.changeIceState("disconnected");
            await clock.tickAsync(STATS_READ_TIME_LIMIT_MS - 1);
            expect(states).to.deep.equal([]);
            await clock.tickAsync(1);
            expect(states).to.deep.equal([
                {
                    connectionState: "new",
                    iceState: "disconnected",
                    path: undefined
                }
            ]);
            expect(errors.map((error) => error.message)).to.deep.equal([
                `WebRTC getStats() did not settle within ${STATS_READ_TIME_LIMIT_MS} ms`
            ]);

            connection.changeIceState("connected");
            await clock.tickAsync(0);
            expect(states.map((state) => state.iceState)).to.deep.equal([
                "disconnected",
                "connected"
            ]);
            expect(states[1].path).to.deep.equal({
                dtlsState: "connected",
                selectedPairChanges: 1,
                ...SELECTED_PAIR_STATS
            });
            expect(errors).to.have.length(1);
        } finally {
            clock.restore();
        }
    });

    it("reports nothing more for a connection once it is closed, also a change whose stats read was running", async function () {
        const { factory, peerAddress, connection, states } =
            await openConnection(true);
        connection.statsReport = SELECTED_PATH;
        const first = statsHold();
        connection.statsHolds.push(first.hold);

        connection.changeState("disconnected", "disconnected");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await factory.close(peerAddress);
        first.release();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(states).to.deep.equal([]);
    });

    it("reports nothing more for a connection replaced by the peer's next one, and reports the next one's changes", async function () {
        const { factory, peerAddress, callbacks, connections, states } =
            await openConnection(true);
        await factory.createOffer(peerAddress, callbacks);

        connections[0].changeState("failed", "failed");
        connections[1].changeState("connected", "connected");
        await waitFor(() => states.length === 2, 5_000, 5);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(
            states.map((state) => `${state.connectionState}/${state.iceState}`)
        ).to.deep.equal(["new/connected", "connected/connected"]);
    });

    it("reads the pair marked selected where the runtime has no transport stats, as Firefox reports it", async function () {
        const { connection, states } = await openConnection(true);
        connection.statsReport = FIREFOX_SELECTED_PATH;

        connection.changeState("connected", "connected");
        await waitFor(() => states.length === 2, 5_000, 5);

        expect(states[1].path).to.deep.equal({
            dtlsState: undefined,
            selectedPairChanges: undefined,
            ...SELECTED_PAIR_STATS
        });
    });

    it("reports only the transport stats while no candidate pair is selected", async function () {
        const { connection, states } = await openConnection(true);
        connection.statsReport = NO_SELECTED_PATH;

        connection.changeState("connecting", "checking");
        await waitFor(() => states.length === 2, 5_000, 5);

        expect(states[1].path).to.deep.equal({
            dtlsState: "new",
            selectedPairChanges: undefined,
            pairState: undefined,
            localCandidate: undefined,
            remoteCandidate: undefined,
            roundTripTimeMs: undefined,
            requestsSent: undefined,
            responsesReceived: undefined,
            requestsReceived: undefined,
            responsesSent: undefined,
            consentRequestsSent: undefined,
            packetsSent: undefined,
            packetsReceived: undefined,
            msSinceLastPacketSent: undefined,
            msSinceLastPacketReceived: undefined
        });
    });

    it("raises a throw in the state handling once as an unhandled rejection, not as a reported factory error, and still reports the later changes", async function () {
        const failure = new Error("state handling failed");
        const unhandled = recordUnhandledRejections();
        try {
            const { connection, states, errors } = await openConnection(
                false,
                failure
            );

            connection.changeState("connected", "connected");
            await waitFor(() => states.length === 2, 5_000, 5);
            expect(await unhandled.settled()).to.deep.equal([failure]);

            connection.changeState("disconnected", "disconnected");
            await waitFor(() => states.length === 4, 5_000, 5);
            expect(await unhandled.settled()).to.deep.equal([failure]);

            expect(
                states.map(
                    (state) => `${state.connectionState}/${state.iceState}`
                )
            ).to.deep.equal([
                "new/connected",
                "connected/connected",
                "connected/disconnected",
                "disconnected/disconnected"
            ]);
            expect(errors).to.deep.equal([]);
        } finally {
            unhandled.stop();
        }
    });
});
