import { BytesLike, SignatureLike, ethers } from "ethers";
import {
    SignedBlockStruct,
    SignedJoinChannelStruct
} from "../../typechain-types/contracts/V1/DataTypes";
import Clock from "../Clock";
import { ExecutionFlags } from "../DataTypes";
import P2PManager from "../P2PManager";
import ARpcService from "./ARpcService";
import RpcProxy, { RpcHandleMethods } from "./RpcProxy";
import ATransport from "../transport/ATransport";
import EvmUtils from "../utils/EvmUtils";
import SignatureCollectionMap from "../utils/SignatureCollectionMap";
// import dotenv from "dotenv";
import DebugProxy from "../utils/DebugProxy";

let DEBUG_RPC = false;
// dotenv.config();
// DEBUG_RPC = process.env.DEBUG_P2P_MANAGER === "true";
//TODO! refactor this
type JoinChanenelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: SignatureLike[];
};

class MainRpcService extends ARpcService {
    p2pManager: P2PManager;
    rpcProxy = RpcProxy.createProxy(this);

    // **** part of joinChannel logic ****
    joinChannelMap = new SignatureCollectionMap();
    joinChannelQueue: JoinChanenelConfirmation[] = [];
    //execution context
    senderTransport: ATransport | undefined; //TODO! set this
    self = DEBUG_RPC ? DebugProxy.createProxy(this) : this;
    constructor(p2pManager: P2PManager) {
        super();
        this.p2pManager = p2pManager;
        return this.self;
    }

    // ********************* INIT HANDSHAKE *********************

    public async onInitHandshakeRequest(challengeHash: string, time: number) {
        let localTime = Clock.getTimeInSeconds();
        if (
            Math.abs(time - localTime) >
            this.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            //TODO!
            //Disconnect & resolve(false)
            console.log(
                `onInitHandshakeRequest - time difference too big - time:${time} localTime:${localTime} diff:${
                    time - localTime
                } aggreeTime:${
                    this.p2pManager.stateManager.timeConfig.agreementTime
                }`
            );
            return;
        }
        console.log(
            `onInitHandshakeRequest - localTime:${localTime} time:${time}`
        );
        let challengeHashBytes = ethers.getBytes(challengeHash);
        let signature = await this.p2pManager.p2pSigner.signMessage(
            challengeHashBytes
        );
        console.log(`onInitHandshakeRequest - done`);
        this.rpcProxy
            .onInitHandshakeResponse(signature, localTime)
            .sendOne(this.senderTransport!);
    }

    public async onInitHandshakeResponse(
        signature: string,
        responseTime: number
    ) {
        console.log(`onInitHandshakeRESPONSE - start`);
        let profile = this.p2pManager.profileManager.getProfileByTransport(
            this.senderTransport!
        );
        if (!profile) {
            // TODO! Disconnect
            return;
        }
        let challenge = profile.getChallenge();
        if (!challenge) {
            // TODO! Disconnect
            this.p2pManager.removeConnection(profile.transport);
            return;
        }
        let localTime = Clock.getTimeInSeconds();
        let rtt = localTime - challenge.initTime;
        if (rtt > this.p2pManager.stateManager.timeConfig.agreementTime) {
            // TODO! Disconnect
            this.p2pManager.removeConnection(profile.transport);
            return;
        }
        if (
            Math.abs(responseTime - challenge.initTime) >
            this.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            // TODO! Disconnect
            this.p2pManager.removeConnection(profile.transport);
            return;
        }
        //verify signature
        let challengeHashBytes = ethers.getBytes(challenge.randomChallengeHash);
        let signerAddress = ethers.verifyMessage(challengeHashBytes, signature);
        // let p =
        //     this.p2pManager.profileManager.getProfileByEvmAddress(
        //         signerAddress
        //     );
        // if (p) {
        //     this.p2pManager.removeConnection(p.transport);
        //     console.log(
        //         `onInitHandshakeRESPONSE - duplicate address - DISCONNECT`
        //     );
        //     return;
        // }
        profile.setEvmAddress(signerAddress);
        profile.setIsHandshakeCompleted(true);
        this.p2pManager.profileManager.registerProfile(profile); // essentially performing an update
        console.log(`onInitHandshakeRESPONSE - done`);
        //TODO! RESOLVE SUCCESS - set some flag also
        this.p2pManager.stateManager.p2pEventHooks.onConnection?.(
            signerAddress
        );
        //TODO! TEST!!
        // this.rpcProxy
        //     .onSignJoinChannelTEST(
        //         this.p2pManager.p2pSigner.signedJc.encodedJoinChannel,
        //         this.p2pManager.p2pSigner.signedJc.signature
        //     )
        //     .broadcast();
    }
    // ********************* TODO! TEST this is only for test *********************
    public async onSignJoinChannelTEST(jcEncoded: string, jcSignature: string) {
        console.log(`Opening channel`);
        try {
            this.p2pManager.stateManager.stateChannelManagerContract.openChannel(
                this.p2pManager.stateManager.getChannelId(),
                [
                    this.p2pManager.p2pSigner.signedJc.encodedJoinChannel,
                    jcEncoded
                ],
                [this.p2pManager.p2pSigner.signedJc.signature, jcSignature]
            );
        } catch (e) {
            console.log("Opening channel error:", e);
        }
    }

    // ********************* State transition logic *********************
    public async onSignedBlock(signedBlock: SignedBlockStruct) {
        //TODO! - require seccusfull init handshake (also on other methods)
        let flag = await this.p2pManager.stateManager.onSignedBlock(
            signedBlock
        );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.rpcProxy.onSignedBlock(signedBlock).broadcast(); //TODO? - broadcast dispute so others can learn about it
    }

    public async onBlockConfirmation(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ) {
        let flag = await this.p2pManager.stateManager.onBlockConfirmation(
            originalSignedBlock,
            confirmationSignature
        );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.rpcProxy
                .onBlockConfirmation(originalSignedBlock, confirmationSignature)
                .broadcast();
    }
}
export default MainRpcService;
