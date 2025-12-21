import { ethers } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import Clock from "@/Clock";

import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";
import PeerProfile from "@/PeerProfile";
import { Hash, Signature, Timestamp } from "@/types/types";
import InitHandshakeRpcMethods from "./InitHandshakeRpcMethods";
import type P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";

type ConnectionChallenge = {
    randomChallengeHash: string;
    initTime: number;
};

class InitHandshakeService extends ARpcService<InitHandshakeRpcMethods> {
    mapTransportToChallenge: WeakMap<ATransport, ConnectionChallenge> =
        new WeakMap<ATransport, ConnectionChallenge>();
    timeoutManager: TimeoutManager;
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "InitHandshakeService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
    }

    public createRPCMethods(transport: ATransport): InitHandshakeRpcMethods {
        return new InitHandshakeRpcMethods(transport, this);
    }

    //Called locally to initiate the handshake
    public initHandshake(transport: ATransport) {
        const randomChallengeHash = ethers.keccak256(ethers.randomBytes(32));
        const time = Clock.getTimeInSeconds();
        this.setChallenge(transport, { randomChallengeHash, initTime: time });
        this.remoteRpc.initHandshakeService
            .onInitHandshakeRequest(randomChallengeHash, time)
            .sendOne(transport);
        // expect a response or disconnect
        this.timeoutManager.scheduleTask(
            () => {
                if (!this.didRespond(transport))
                    this.p2pManager.disconnectConnection(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "InitHandshakeService - initHandshake timeout"
        );
    }

    public setChallenge(transport: ATransport, challenge: ConnectionChallenge) {
        this.mapTransportToChallenge.set(transport, challenge);
    }

    public getChallenge(
        transport: ATransport
    ): ConnectionChallenge | undefined {
        return this.mapTransportToChallenge.get(transport);
    }

    public didRespond(transport: ATransport): boolean {
        return !this.getChallenge(transport);
    }
}

export default InitHandshakeService;
