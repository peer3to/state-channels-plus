import sinon from "sinon";
import { ethers } from "ethers";

import { createLogger, getChecksumAddress } from "@/utils";
import { EventBus } from "@/events/EventBus";
import LobbyService from "@/rpc/services/lobby/LobbyService";
import LobbyRpcMethods, {
    type LobbyP2PManager
} from "@/rpc/services/lobby/LobbyRpcMethods";
import type ATransport from "@/transport/ATransport";

/**
 * Shared test factory for LobbyService/LobbyRpcMethods unit coverage.
 * `LobbyP2PManager` (P2PManager<...>) is a large class with several
 * private fields - a plain object literal typed directly against it fails
 * tsc, so the cast below is confined to exactly the surface LobbyService
 * touches: stateManager (logger/events/signerAddress/signer.provider/
 * stateChannelManagerContract/diamondStateMachine), holepunch.join/leave,
 * remoteRpc.lobbyService (wire calls), and localRpc (opt-in
 * OpenChannelNegotiationService capability check). Mirrors
 * test/rpc/openChannelNegotiation/negotiationTestFactory.ts.
 */
const DEFAULT_ME_ADDRESS = getChecksumAddress("0x" + "22".repeat(20));
const DEFAULT_SCM_ADDRESS = getChecksumAddress("0x" + "33".repeat(20));

export type LobbyServiceHarness = {
    service: LobbyService;
    events: EventBus;
    joinStub: sinon.SinonStub;
    leaveStub: sinon.SinonStub;
    advertiseSpy: sinon.SinonStub;
    advertiseSendOneSpy: sinon.SinonStub;
    withdrawSpy: sinon.SinonStub;
    withdrawSendOneSpy: sinon.SinonStub;
    requestIntentSpy: sinon.SinonStub;
    requestIntentRequestStub: sinon.SinonStub;
    releaseIntentSpy: sinon.SinonStub;
    releaseIntentRequestStub: sinon.SinonStub;
};

export function makeLobbyService(
    meAddress: string = DEFAULT_ME_ADDRESS,
    scmAddress: string = DEFAULT_SCM_ADDRESS
): LobbyServiceHarness {
    const events = new EventBus();
    const joinStub = sinon.stub().resolves();
    const leaveStub = sinon.stub().resolves();

    const advertiseSpy = sinon.stub();
    const advertiseSendOneSpy = sinon.stub();
    const withdrawSpy = sinon.stub();
    const withdrawSendOneSpy = sinon.stub();
    const requestIntentSpy = sinon.stub();
    const requestIntentRequestStub = sinon.stub().resolves({ accepted: true });
    const releaseIntentSpy = sinon.stub();
    const releaseIntentRequestStub = sinon.stub().resolves({
        released: true
    });

    const p2pManager = {
        stateManager: {
            logger: createLogger({}, {}, { level: "error" }),
            signerAddress: meAddress,
            events,
            signer: {
                provider: {
                    getNetwork: async () => ({ chainId: 1n }) as any
                }
            },
            stateChannelManagerContract: {
                getAddress: async () => scmAddress
            },
            diamondStateMachine: {
                getStateMachineAddress: () => scmAddress
            }
        },
        holepunch: {
            join: joinStub,
            leave: leaveStub
        },
        // No pre-existing peers in these unit tests - discovery is always
        // via the handshakeCompleted bus event, driven explicitly by each test.
        getHandshakeCompletedPeers: () => new Set<string>(),
        remoteRpc: {
            lobbyService: {
                advertise: (encodedAd: string) => {
                    advertiseSpy(encodedAd);
                    return { sendOne: advertiseSendOneSpy };
                },
                withdraw: (adId: string) => {
                    withdrawSpy(adId);
                    return { sendOne: withdrawSendOneSpy };
                },
                requestIntent: (encodedAd: string, amount: string) => {
                    requestIntentSpy(encodedAd, amount);
                    return { request: requestIntentRequestStub };
                },
                releaseIntent: (adId: string) => {
                    releaseIntentSpy(adId);
                    return { request: releaseIntentRequestStub };
                }
            }
        },
        localRpc: {}
    } as unknown as LobbyP2PManager;

    return {
        service: new LobbyService(p2pManager),
        events,
        joinStub,
        leaveStub,
        advertiseSpy,
        advertiseSendOneSpy,
        withdrawSpy,
        withdrawSendOneSpy,
        requestIntentSpy,
        requestIntentRequestStub,
        releaseIntentSpy,
        releaseIntentRequestStub
    };
}

/** Builds a LobbyRpcMethods for `service`, as if `fromAddress` were the sender. */
export function makeRpcMethods(
    service: LobbyService,
    fromAddress: string
): LobbyRpcMethods {
    const transport = { peerAddress: fromAddress } as unknown as ATransport;
    return new LobbyRpcMethods(transport, service);
}

export function randomWalletAddress(): string {
    return getChecksumAddress(ethers.Wallet.createRandom().address);
}
