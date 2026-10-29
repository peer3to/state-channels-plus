import type { SdkSetupService } from "./SdkSetupService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class SdkSetupRpcMethods extends AInternalRpcMethods<SdkSetupService> {
    public deployComplete(localAddress: string, diamondAddress: string) {
        return this.service.deployComplete(
            localAddress,
            diamondAddress,
            this.sender
        );
    }
}
