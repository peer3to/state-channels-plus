import type { RootErrorService } from "./RootErrorService";
import { AInternalRpcMethods } from "../../AInternalRpcMethods";
import type { SerializedError } from "../../errorWire";

export class RootErrorRpcMethods extends AInternalRpcMethods<RootErrorService> {
    public report(error: SerializedError): void {
        this.service.receive(error, this.sender);
    }

    public startupFailed(error: SerializedError): void {
        this.service.startupFailed(error, this.sender);
    }
}
