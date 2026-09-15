import type { LoggerService } from "./LoggerService";
import type { SharedLoggerContext } from "../../../../utils/logging/Logger";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class LoggerRpcMethods extends AInternalRpcMethods<LoggerService> {
    public upload(index: number, reason: string): void {
        this.service.upload(index, reason, this.sender);
    }
    public contextUpdate(context: SharedLoggerContext, index: number): void {
        this.service.contextUpdate(context, index, this.sender);
    }
}
