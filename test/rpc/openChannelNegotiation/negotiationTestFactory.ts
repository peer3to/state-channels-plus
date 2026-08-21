import sinon from "sinon";

import { createLogger, getChecksumAddress } from "@/utils";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import OpenChannelNegotiationRpcMethods, {
    type OpenChannelNegotiationP2PManager
} from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import type ATransport from "@/transport/ATransport";

/**
 * Shared test factory for OpenChannelNegotiationService/RpcMethods unit
 * coverage. `OpenChannelNegotiationP2PManager`
 * (P2PManager<...>) is a ~80-member class with several private fields (a
 * plain object literal typed directly against it fails tsc with "missing the
 * following properties ... and 78 more" — proven while writing this file), so
 * a live instance can only come from a real P2PManager backed by a live
 * chain/session. The *Service methods under test touch nothing on
 * p2pManager except the logger (read once, in the constructor),
 * signerAddress, getChannelId, the negotiation wire calls
 * (abort/negotiateRequest), and disconnectAndBlacklistPeerByEvmAddress — so
 * the cast below is confined to exactly that surface, mirroring the
 * same-class generic-narrowing cast used in
 * test/fixtures/customRpc/PingPongRpcManifest.ts.
 */
const DEFAULT_ME_ADDRESS = getChecksumAddress("0x" + "11".repeat(20));

export type NegotiationServiceHarness = {
    service: OpenChannelNegotiationService;
    abortSpy: sinon.SinonStub;
    sendOneSpy: sinon.SinonStub;
    negotiateRequestSpy: sinon.SinonStub;
    negotiateRequestSendOneSpy: sinon.SinonStub;
    negotiateAcceptSpy: sinon.SinonStub;
    negotiateAcceptSendOneSpy: sinon.SinonStub;
    negotiateBusySpy: sinon.SinonStub;
    negotiateBusySendOneSpy: sinon.SinonStub;
    blacklistSpy: sinon.SinonStub;
    // Defaults to an already-closed channel (isChannelOpen resolves [false])
    // so maybeProgress's alreadyOpen short-circuit never trips by accident;
    // override via isChannelOpenStub.resolves([true]) when a test needs it.
    isChannelOpenStub: sinon.SinonStub;
};

export function makeNegotiationService(
    meAddress: string = DEFAULT_ME_ADDRESS,
    channelId: Uint8Array = new Uint8Array(32)
): NegotiationServiceHarness {
    const abortSpy = sinon.stub();
    const sendOneSpy = sinon.stub();
    const negotiateRequestSpy = sinon.stub();
    const negotiateRequestSendOneSpy = sinon.stub();
    const negotiateAcceptSpy = sinon.stub();
    const negotiateAcceptSendOneSpy = sinon.stub();
    const negotiateBusySpy = sinon.stub();
    const negotiateBusySendOneSpy = sinon.stub();
    const blacklistSpy = sinon.stub();
    const isChannelOpenStub = sinon.stub().resolves([false]);

    const p2pManager = {
        stateManager: {
            logger: createLogger({}, {}, { level: "error" }),
            signerAddress: meAddress,
            channelId,
            diamondStateMachine: {
                localDiamondContract: {
                    isChannelOpen: isChannelOpenStub
                }
            },
            refreshOpenedStatusFromChain: sinon.stub().resolves()
        },
        remoteRpc: {
            openChannelNegotiationService: {
                abort: (reason: string) => {
                    abortSpy(reason);
                    return { sendOne: sendOneSpy };
                },
                negotiateRequest: (channelIdArg: string, amount: number) => {
                    negotiateRequestSpy(channelIdArg, amount);
                    return { sendOne: negotiateRequestSendOneSpy };
                },
                negotiateAccept: (channelIdArg: string, amount: number) => {
                    negotiateAcceptSpy(channelIdArg, amount);
                    return { sendOne: negotiateAcceptSendOneSpy };
                },
                negotiateBusy: () => {
                    negotiateBusySpy();
                    return { sendOne: negotiateBusySendOneSpy };
                }
            }
        },
        disconnectAndBlacklistPeerByEvmAddress: (evmAddress: string) => {
            blacklistSpy(evmAddress);
        }
    } as unknown as OpenChannelNegotiationP2PManager;

    return {
        service: new OpenChannelNegotiationService(p2pManager),
        abortSpy,
        sendOneSpy,
        negotiateRequestSpy,
        negotiateRequestSendOneSpy,
        negotiateAcceptSpy,
        negotiateAcceptSendOneSpy,
        negotiateBusySpy,
        negotiateBusySendOneSpy,
        blacklistSpy,
        isChannelOpenStub
    };
}

/** Builds an OpenChannelNegotiationRpcMethods for `service`, as if `fromAddress` were the sender. */
export function makeRpcMethods(
    service: OpenChannelNegotiationService,
    fromAddress: string
): OpenChannelNegotiationRpcMethods {
    const transport = { peerAddress: fromAddress } as unknown as ATransport;
    return new OpenChannelNegotiationRpcMethods(transport, service);
}
