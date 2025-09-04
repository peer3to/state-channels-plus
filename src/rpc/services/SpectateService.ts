import { ARpcService, MainRpcService } from "@/rpc";
import { ChannelId, Timestamp } from "@/types/types";
import { StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";

class SpectateService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    // Called locally to initiate spectate sync
    public spectateSync(transport: ATransport, channelId: ChannelId) {
        console.log("spectateSync !");
        let time = Clock.getTimeInSeconds();
        this.mainRpcService.rpcProxy
            .onSpectateRequest(channelId, time)
            .sendOne(transport);
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        let localTime = Clock.getTimeInSeconds();
        if (
            Math.abs(time - localTime) >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            console.log(
                `onSpectateRequest - time difference too big - time:${time} localTime:${localTime} diff:${
                    time - localTime
                } aggreeTime:${
                    this.mainRpcService.p2pManager.stateManager.timeConfig
                        .agreementTime
                }`
            );
            return;
        }
        console.log(`onSpectateRequest - localTime:${localTime} time:${time}`);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        forkProofData: any,
        stateProofData: any,
        onChainSnapshot: StateSnapshot,
        responseTime: Timestamp
    ) {
        console.log(`onSpectateResponse - start`);
        let localTime = Clock.getTimeInSeconds();
        let rtt = localTime - responseTime;
        if (
            rtt >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            console.log("onSpectateResponse - RTT too high, ignoring");
            return;
        }

        console.log("Spectator successfully synced to latest state");
    }
}

export default SpectateService;
