import { ARpcService, MainRpcService } from "@/rpc";

class TESTJoinChannelService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    public async onSignJoinChannelTEST(jcEncoded: string, jcSignature: string) {
        console.log(`Opening channel`);
        try {
            let txResponse =
                await this.mainRpcService.p2pManager.stateManager.stateChannelManagerContract.openChannel(
                    this.mainRpcService.p2pManager.stateManager.getChannelId(),
                    [
                        this.mainRpcService.p2pManager.p2pSigner.signedJc
                            .encodedJoinChannel,
                        jcEncoded
                    ],
                    [
                        this.mainRpcService.p2pManager.p2pSigner.signedJc
                            .signature,
                        jcSignature
                    ]
                );
            console.log("OPEN - TX HASH ##", txResponse.hash);
            let txReceipt = await txResponse.wait();
            // await block.wait(); //not needed - will be comunicated back through the event
            console.log("CHANNEL OPENED ##", txReceipt);
        } catch (e) {
            console.log("ERROR - Opening channel error:", e);
        }
    }
}

export default TESTJoinChannelService;
