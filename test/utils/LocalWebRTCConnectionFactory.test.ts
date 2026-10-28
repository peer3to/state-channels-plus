import LocalWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory";
import type { WebRTCConnectionStateSnapshot } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { RecordingRTCPeerConnection } from "@test/fixtures/P2PTransportFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/** A factory over stand-in connections, recording each connection, state report and error. */
async function openConnection(withStats: boolean) {
    const connections: RecordingRTCPeerConnection[] = [];
    const factory = new LocalWebRTCConnectionFactory({
        RTCPeerConnection: class extends RecordingRTCPeerConnection {
            constructor() {
                super(withStats);
                connections.push(this);
            }
        }
    });
    const peerAddress = ethers.Wallet.createRandom().address;
    const states: WebRTCConnectionStateSnapshot[] = [];
    const errors: Error[] = [];
    const callbacks = {
        onIceCandidate: () => undefined,
        onDataChannel: () => undefined,
        onConnectionStateChange: (state: WebRTCConnectionStateSnapshot) =>
            states.push(state),
        onError: (error: Error) => errors.push(error)
    };
    await factory.createOffer(peerAddress, callbacks);
    return {
        factory,
        peerAddress,
        callbacks,
        connections,
        connection: connections[0],
        states,
        errors
    };
}

/** A hold for one getStats call, and its release. */
function statsHold(): { hold: Promise<void>; release: () => void } {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    return { hold, release };
}

const SELECTED_PATH = new Map<string, Record<string, any>>([
    [
        "T",
        {
            type: "transport",
            selectedCandidatePairId: "P",
            dtlsState: "connected",
            selectedCandidatePairChanges: 1
        }
    ],
    [
        "P",
        {
            type: "candidate-pair",
            timestamp: 10_000,
            state: "succeeded",
            localCandidateId: "L",
            remoteCandidateId: "R",
            currentRoundTripTime: 0.012,
            requestsSent: 20,
            responsesReceived: 18,
            requestsReceived: 19,
            responsesSent: 19,
            consentRequestsSent: 15,
            packetsSent: 100,
            packetsReceived: 90,
            lastPacketSentTimestamp: 9_900,
            lastPacketReceivedTimestamp: 7_000
        }
    ],
    ["L", { type: "local-candidate", candidateType: "host", protocol: "udp" }],
    ["R", { type: "remote-candidate", candidateType: "srflx", protocol: "udp" }]
]);

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
            pairState: "succeeded",
            localCandidate: "host udp",
            remoteCandidate: "srflx udp",
            roundTripTimeMs: 12,
            requestsSent: 20,
            responsesReceived: 18,
            requestsReceived: 19,
            responsesSent: 19,
            consentRequestsSent: 15,
            packetsSent: 100,
            packetsReceived: 90,
            msSinceLastPacketSent: 100,
            msSinceLastPacketReceived: 3000
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
});
