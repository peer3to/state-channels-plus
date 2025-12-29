import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import TESTJoinChannelService from "./TESTJoinChannelService";
import { StructuredLogger } from "@/utils/logging";

class TESTJoinChannelRpcMethods extends ARpcMethods {
    service: TESTJoinChannelService;
    private log: StructuredLogger;

    constructor(transport: ATransport, service: TESTJoinChannelService) {
        super(transport, service.p2pManager);
        this.service = service;
        this.log = new StructuredLogger(
            service.logger as any,
            "TESTJoinChannelRpcMethods"
        );
    }

    public async onSignJoinChannelTEST(
        _jcEncoded: string,
        jcSignature: string
    ) {
        console.log(`Opening channel`);
        try {
            const txResponse =
                await this.p2pManager.stateManager.stateChannelManagerContract.joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel:
                                this.p2pManager.p2pSigner.signedJc
                                    .encodedJoinChannel,
                            signature:
                                this.p2pManager.p2pSigner.signedJc.signature
                        },
                        signatures: [
                            this.p2pManager.p2pSigner.signedJc.signature,
                            jcSignature
                        ]
                    }
                );
            console.log("OPEN - TX HASH ##", txResponse.hash);
            const txReceipt = await txResponse.wait();
            this.log.gas("joinChannel", txReceipt);
            // await block.wait(); //not needed - will be comunicated back through the event
            console.log("CHANNEL OPENED ##", txReceipt);
        } catch (e) {
            console.log("ERROR - Opening channel error:", e);
        }
    }
}

export default TESTJoinChannelRpcMethods;
