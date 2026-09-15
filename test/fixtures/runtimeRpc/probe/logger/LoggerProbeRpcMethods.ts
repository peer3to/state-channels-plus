// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { LoggerProbeService } from "./LoggerProbeService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
import type { SharedLoggerContext } from "@/utils/logging/Logger";

export class LoggerProbeRpcMethods extends AInternalRpcMethods<LoggerProbeService> {
    public uploadState() {
        return this.service.uploadState();
    }
    public frames() {
        return this.service.frames();
    }
    public write(message: string): void {
        this.service.logger.info(message);
    }
    public error(message: string): void {
        this.service.logger.error(message);
    }
    public childWrite(message: string): void {
        const child = this.service.logger.child({ component: "Child" });
        try {
            child.info(message);
        } finally {
            child.dispose();
        }
    }
    public clearRealm(): void {
        this.service.clearRealm();
    }
    public flush(reason: string) {
        return this.service.logger.upload(reason);
    }
    public own() {
        return this.service.logger.uploadOwnLogs();
    }
    public report(reason: string) {
        return this.service.logger.uploadLogs(reason);
    }
    public context() {
        return { ...this.service.logger.getSharedContext() };
    }
    public updateContext(context: SharedLoggerContext): void {
        this.service.updateContext(context);
    }
    public disposeLogger(): void {
        this.service.logger.dispose();
    }
    public captureUnhandled(message: string): void {
        this.service.captureUnhandled(message);
    }
    public childWriteAtEndpoint(message: string) {
        return this.service.visitChild((child) =>
            child.loggerProbe.write(message).request()
        );
    }
    public clearChildRealm() {
        return this.service.visitChild((child) =>
            child.loggerProbe.clearRealm().request()
        );
    }
    public childFlush(reason: string) {
        return this.service.visitChild((child) =>
            child.loggerProbe.flush(reason).request()
        );
    }
    public childOwn() {
        return this.service.visitChild((child) =>
            child.loggerProbe.own().request()
        );
    }
    public childContext() {
        return this.service.visitChild((child) =>
            child.loggerProbe.context().request()
        );
    }
    public childCaptureUnhandled(message: string) {
        return this.service.visitChild((child) =>
            child.loggerProbe.captureUnhandled(message).request()
        );
    }
}
