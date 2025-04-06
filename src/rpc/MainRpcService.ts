import { AddressLike, BytesLike, SignatureLike } from "ethers";
import {
    SignedBlockStruct,
    SignedJoinChannelStruct
} from "@typechain-types/contracts/V1/DataTypes";

import P2PManager from "@/P2PManager";
import RpcProxy from "./RpcProxy";
import ATransport from "@/transport/ATransport";
import DebugProxy from "@/utils/DebugProxy";
import { TransportType } from "@/transport/TransportType";
import {
    InitHandshakeService,
    StateTransitionService,
    TESTJoinChannelService,
    DHTDiscoveryService,
    JoinChannelService,
    WebRTCSetupService
} from "./services";

let DEBUG_RPC = false;
// dotenv.config();
// DEBUG_RPC = process.env.DEBUG_P2P_MANAGER === "true";
//TODO! refactor this
type JoinChanenelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: SignatureLike[];
};

class MainRpcService {
    p2pManager: P2PManager;
    rpcProxy = RpcProxy.createProxy(this);

    //execution context
    senderTransport: ATransport | undefined; //TODO! set this
    self = DEBUG_RPC ? DebugProxy.createProxy(this) : this;

    //RPC Services
    initHandshakeService = new InitHandshakeService(this.self);
    webRTCSetunService = new WebRTCSetupService(this.self);
    stateTransitionService = new StateTransitionService(this.self);
    testJoinChannelService = new TESTJoinChannelService(this.self);
    dhtDiscoveryService = new DHTDiscoveryService(this.self);
    joinChannelService = new JoinChannelService(this.self);

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        return this.self;
    }

    // ********************* InitHandskaheService *********************

    public async onInitHandshakeRequest(challengeHash: string, time: number) {
        this.initHandshakeService.onInitHandshakeRequest(challengeHash, time);
    }

    public async onInitHandshakeResponse(
        signature: string,
        responseTime: number,
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
        this.webRTCSetunService.onOfferWebRTC(offer);
    }

    public async onAnswerWebRTC(answer: string) {
        this.webRTCSetunService.onAnswerWebRTC(answer);
    }

    public async onIceCandidate(serializedCandidate: string) {
        this.webRTCSetunService.onIceCandidate(serializedCandidate);
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
        channelId: BytesLike,
        participants: AddressLike[]
    ) {
        this.dhtDiscoveryService.onCanJoinLeaderResponse(
            channelId,
            participants
        );
    }
    // ********************* JoinChannelService *********************
    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: SignatureLike
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
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ) {
        this.stateTransitionService.onBlockConfirmation(
            originalSignedBlock,
            confirmationSignature
        );
    }
}
export default MainRpcService;
