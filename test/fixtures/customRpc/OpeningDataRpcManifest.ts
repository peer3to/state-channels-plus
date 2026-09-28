// @spec-test-coverage-ignore: test-only custom root; executable evidence is mapped from its test files
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";
import { OpeningDataNegotiationService } from "./openingDataProbe/OpeningDataNegotiationService";
import { OpeningDataProbeService } from "./openingDataProbe/OpeningDataProbeService";
import type P2PManager from "@/P2PManager";

/**
 * A custom root that supplies application opening data, like a consumer
 * root deriving its genesis, plus the probe that drives its negotiation.
 */
export class OpeningDataRpc extends HarnessControlRpc {
    declare openChannelNegotiationService: OpeningDataNegotiationService;
    openingDataProbe: OpeningDataProbeService;

    constructor(p2pManager: P2PManager<OpeningDataRpc>) {
        super(p2pManager);
        this.openChannelNegotiationService = new OpeningDataNegotiationService(
            p2pManager
        );
        this.openingDataProbe = new OpeningDataProbeService(p2pManager);
    }
}

export default OpeningDataRpc;
