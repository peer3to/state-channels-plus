import { MainRpcService } from "@/rpc";

abstract class ARpcService {
    mainRpcService: MainRpcService;

    constructor(mainRpcService: MainRpcService) {
        this.mainRpcService = mainRpcService;
    }
}

export default ARpcService;
