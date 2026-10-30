// @spec-test-coverage-ignore: connection and stats stand-ins for LocalWebRTCConnectionFactory component tests
import LocalWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory";
import type { WebRTCConnectionStateSnapshot } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { RecordingRTCPeerConnection } from "@test/fixtures/P2PTransportFixture";
import { ethers } from "ethers";

/**
 * A factory over stand-in connections, recording each connection, state
 * report and error. With `stateHandlingFailure`, handling the first state
 * report throws it.
 */
export async function openConnection(
    withStats: boolean,
    stateHandlingFailure?: Error
) {
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
        onConnectionStateChange: (state: WebRTCConnectionStateSnapshot) => {
            states.push(state);
            if (states.length === 1 && stateHandlingFailure)
                throw stateHandlingFailure;
        },
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
export function statsHold(): { hold: Promise<void>; release: () => void } {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    return { hold, release };
}

const SELECTED_PAIR = {
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
};

const CANDIDATES: [string, Record<string, any>][] = [
    ["L", { type: "local-candidate", candidateType: "host", protocol: "udp" }],
    ["R", { type: "remote-candidate", candidateType: "srflx", protocol: "udp" }]
];

/** A transport that names its selected pair, as Chrome reports it. */
export const SELECTED_PATH = new Map<string, Record<string, any>>([
    [
        "T",
        {
            type: "transport",
            selectedCandidatePairId: "P",
            dtlsState: "connected",
            selectedCandidatePairChanges: 1
        }
    ],
    ["P", SELECTED_PAIR],
    ...CANDIDATES
]);

/** No transport stats; the pair marks itself selected, as Firefox reports it. */
export const FIREFOX_SELECTED_PATH = new Map<string, Record<string, any>>([
    ["O", { ...SELECTED_PAIR, id: "O", state: "failed", selected: false }],
    ["P", { ...SELECTED_PAIR, selected: true }],
    ...CANDIDATES
]);

/** A transport with no selected pair yet, and a pair nobody selected. */
export const NO_SELECTED_PATH = new Map<string, Record<string, any>>([
    ["T", { type: "transport", dtlsState: "new" }],
    ["P", { ...SELECTED_PAIR, state: "in-progress" }],
    ...CANDIDATES
]);

/** The path stats the factory reads from the selected pair and its candidates. */
export const SELECTED_PAIR_STATS = {
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
};
