import ARpcService from "../ARpcService";
import MainRpcService from "../MainRpcService";
import Clock from "../../Clock";
import { ethers } from "ethers";
import { TransportType } from "../../transport/TransportType";
import ATransport from "../../transport/ATransport";
import PeerProfile from "../../PeerProfile";

type ConnectionChallenge = {
    randomChallengeHash: string;
    initTime: number;
};

class InitHandskaheService extends ARpcService {
    private mapTransportToChallenge: WeakMap<ATransport, ConnectionChallenge> =
        new WeakMap<ATransport, ConnectionChallenge>();

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    //Called localy to initiate the handshake
    public initHandshake(transport: ATransport) {
        console.log("initHandshake !");
        let randomChallengeHash = ethers.keccak256(ethers.randomBytes(32));
        let time = Clock.getTimeInSeconds();
        this.setChallenge(transport, { randomChallengeHash, initTime: time });
        this.mainRpcService.rpcProxy
            .onInitHandshakeRequest(randomChallengeHash, time)
            .sendOne(transport);
    }

    public async onInitHandshakeRequest(challengeHash: string, time: number) {
        let localTime = Clock.getTimeInSeconds();
        if (
            Math.abs(time - localTime) >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            //TODO!
            //Disconnect & resolve(false)
            console.log(
                `onInitHandshakeRequest - time difference too big - time:${time} localTime:${localTime} diff:${
                    time - localTime
                } aggreeTime:${
                    this.mainRpcService.p2pManager.stateManager.timeConfig
                        .agreementTime
                }`
            );
            return;
        }
        console.log(
            `onInitHandshakeRequest - localTime:${localTime} time:${time}`
        );
        let challengeHashBytes = ethers.getBytes(challengeHash);
        let signature =
            await this.mainRpcService.p2pManager.p2pSigner.signMessage(
                challengeHashBytes
            );
        console.log(`onInitHandshakeRequest - done`);
        this.mainRpcService.rpcProxy
            .onInitHandshakeResponse(
                signature,
                localTime,
                this.mainRpcService.p2pManager.preferredTransport
            )
            .sendOne(this.mainRpcService.senderTransport!);
    }

    public async onInitHandshakeResponse(
        signature: string,
        responseTime: number,
        preferredTransport: TransportType
    ) {
        console.log(`onInitHandshakeRESPONSE - start`);
        let senderTransport = this.mainRpcService.senderTransport;
        if (!senderTransport) throw new Error("senderTransport is undefined");
        let challenge = this.getChallenge(senderTransport);
        if (!challenge) {
            // TODO! Disconnect
            this.mainRpcService.p2pManager.removeConnection(senderTransport);
            return;
        }
        let localTime = Clock.getTimeInSeconds();
        let rtt = localTime - challenge.initTime;
        if (
            rtt >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            // TODO! Disconnect
            this.mainRpcService.p2pManager.removeConnection(senderTransport);
            return;
        }
        if (
            Math.abs(responseTime - challenge.initTime) >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            // TODO! Disconnect
            this.mainRpcService.p2pManager.removeConnection(senderTransport);
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
        let profile =
            this.mainRpcService.p2pManager.profileManager.getProfileByEvmAddress(
                signerAddress
            );
        if (!profile) {
            profile = new PeerProfile(senderTransport, signerAddress);
            this.mainRpcService.p2pManager.profileManager.registerProfile(
                profile
            );
        } else {
            this.mainRpcService.p2pManager.profileManager.updateTransport(
                profile.getEvmAddress().toString(),
                senderTransport
            );
        }
        profile.setIsHandshakeCompleted(true);
        if (
            (preferredTransport === TransportType.WEBRTC ||
                this.mainRpcService.p2pManager.preferredTransport ===
                    TransportType.WEBRTC) &&
            senderTransport.transportType != TransportType.WEBRTC &&
            this.mainRpcService.p2pManager.p2pSigner.signerAddress <
                signerAddress
        ) {
            this.mainRpcService.webRTCSetunService.initiateWebRTC();
        }
        console.log(`onInitHandshakeRESPONSE - done`);
        //TODO! RESOLVE SUCCESS - set some flag also
        this.mainRpcService.p2pManager.stateManager.p2pEventHooks.onConnection?.(
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

    private setChallenge(
        transport: ATransport,
        challenge: ConnectionChallenge
    ) {
        this.mapTransportToChallenge.set(transport, challenge);
    }
    private getChallenge(
        transport: ATransport
    ): ConnectionChallenge | undefined {
        return this.mapTransportToChallenge.get(transport);
    }
}

export default InitHandskaheService;
