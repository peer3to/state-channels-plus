import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import DHTDiscoveryService from "./DHTDiscoveryService";

class DHTDiscoveryRpcMethods extends ARpcMethods {
    service: DHTDiscoveryService;
    constructor(transport: ATransport, service: DHTDiscoveryService) {
        super(transport, service.p2pManager);
        this.service = service;
    }
}

export default DHTDiscoveryRpcMethods;
