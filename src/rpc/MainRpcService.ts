import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    SignedJoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { SignedDisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import P2PManager from "@/P2PManager";
import RpcProxy from "./RpcProxy";
import ATransport from "@/transport/ATransport";
import { DebugProxy } from "@/utils";
import { TransportType } from "@/transport/TransportType";
import {
    InitHandshakeService,
    StateTransitionService,
    TESTJoinChannelService,
    DHTDiscoveryService,
    JoinChannelService,
    WebRTCSetupService
} from "./services";
import { DEBUG_RPC } from "@/utils/config";
import { Address, ChannelId, Hash, Signature, Timestamp } from "@/types/types";

//TODO! refactor this
type JoinChanenelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: Signature[];
};

class MainRpcService {
    p2pManager: P2PManager;
    rpcProxy = RpcProxy.createProxy(this);

    //execution context
    senderTransport: ATransport | undefined; //TODO! set this
    self = DEBUG_RPC ? DebugProxy.createProxy(this) : this;

    //RPC Services
    initHandshakeService = new InitHandshakeService(this.self);
    webRTCSetupService = new WebRTCSetupService(this.self);
    stateTransitionService = new StateTransitionService(this.self);
    testJoinChannelService = new TESTJoinChannelService(this.self);
    dhtDiscoveryService = new DHTDiscoveryService(this.self);
    joinChannelService = new JoinChannelService(this.self);

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        return this.self;
    }

    // ********************* InitHandskaheService *********************

    public async onInitHandshakeRequest(challengeHash: Hash, time: Timestamp) {
        this.initHandshakeService.onInitHandshakeRequest(challengeHash, time);
    }

    public async onInitHandshakeResponse(
        signature: Signature,
        responseTime: Timestamp,
        preferredTransport: TransportType
    ) {
        this.initHandshakeService.onInitHandshakeResponse(
            signature,
            responseTime,
            preferredTransport
        );
    }

    // ********************* WebRTCSetupService *********************
    public async onOfferWebRTC(offer: string) {
        this.webRTCSetupService.onOfferWebRTC(offer);
    }

    public async onAnswerWebRTC(answer: string) {
        this.webRTCSetupService.onAnswerWebRTC(answer);
    }

    public async onIceCandidate(serializedCandidate: string) {
        this.webRTCSetupService.onIceCandidate(serializedCandidate);
    }

    // ********************* TESTJoinChannelService - TODO! TEST this is only for test *********************
    public async onSignJoinChannelTEST(jcEncoded: string, jcSignature: string) {
        this.testJoinChannelService.onSignJoinChannelTEST(
            jcEncoded,
            jcSignature
        );
    }
    // ********************* DHTDiscoveryService - DHT discovery, common topic, leader introduction to specific channelID *********************
    public async onCanJoinLeaderRequest() {
        this.dhtDiscoveryService.onCanJoinLeaderRequest();
    }
    public async onCanJoinLeaderResponse(
        channelId: ChannelId,
        participants: Address[]
    ) {
        this.dhtDiscoveryService.onCanJoinLeaderResponse(
            channelId,
            participants
        );
    }
    // ********************* JoinChannelService *********************
    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: Signature
    ) {
        this.joinChannelService.onJoinChannelRequest(
            signedJoinChannel,
            confirmationSignature
        );
    }

    // ********************* StateTransitionService *********************
    public async onSignedBlock(signedBlock: SignedBlockStruct) {
        this.stateTransitionService.onSignedBlock(signedBlock);
    }

    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ) {
        this.stateTransitionService.onBlockConfirmation(blockConfirmation);
    }

    public async onDisputeConfirmation(signedDispute: SignedDisputeStruct) {
        this.stateTransitionService.onDisputeConfirmation(signedDispute);
    }
}
export default MainRpcService;
