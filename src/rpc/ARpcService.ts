import { MainRpcService } from "@/rpc";
import ATransport from "@/transport/ATransport";

abstract class ARpcService {
    mainRpcService: MainRpcService;

    constructor(mainRpcService: MainRpcService) {
        this.mainRpcService = mainRpcService;
    }

    /**
     * Get the current sender transport from the execution context
     */
    protected getCurrentSenderTransport(): ATransport | undefined {
        return this.mainRpcService.getCurrentSenderTransport();
    }
}

export default ARpcService;
