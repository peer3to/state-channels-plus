// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { RuntimeProbeService } from "./RuntimeProbeService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

class InheritedRuntimeProbeRpcMethods extends AInternalRpcMethods<RuntimeProbeService> {
    public inherited(): string {
        return "inherited";
    }
    public shadowed(): string {
        return "inherited shadow";
    }
}

export class RuntimeProbeRpcMethods extends InheritedRuntimeProbeRpcMethods {
    public disposeDomain() {
        return this.service.disposeDomain();
    }
    public own(): string {
        return "own";
    }
    public captured(): string {
        return "original";
    }
    public configure(
        mode: "ordinary" | "accessor" | "nonFunction" | "capture"
    ): void {
        this.service.mode = mode;
    }
    public descriptorState() {
        return { accessorReads: this.service.accessorReads };
    }

    public postFrame(frame: unknown): void {
        this.service.postFrame(this.sender, frame);
    }
    public transferredPort(
        port: Parameters<RuntimeProbeService["sendOnTransferredPort"]>[0],
        value: unknown
    ): void {
        this.service.sendOnTransferredPort(port, value);
    }
    public echo(value?: unknown) {
        return value;
    }
    public sum(left: number, right = 0): number {
        return left + right;
    }
    public reportError(message: string): void {
        this.service.root.reportError(new Error(message));
    }
    public childReportError(message: string) {
        return this.service
            .childConnection()
            .runtimeProbe.reportError(message)
            .request();
    }
    public failSync(message: string): never {
        throw new Error(message);
    }
    public childFail(asyncFailure: boolean, message: string) {
        const child = this.service.childConnection().runtimeProbe;
        return asyncFailure
            ? child.failAsync(message).request()
            : child.failSync(message).request();
    }
    public async failAsync(message: string): Promise<never> {
        throw new Error(message);
    }
    public async hold(key: string, value?: unknown) {
        await this.service.hold(key);
        return value;
    }
    public async voidHold(key: string): Promise<void> {
        await this.service.hold(key);
    }
    public release(key: string): void {
        this.service.release(key);
    }
    public detachFailure(key: string, drainOnly = false): void {
        this.service.detachFailure(key, drainOnly);
    }
    public childDetachFailure(key: string) {
        return this.service
            .childConnection()
            .runtimeProbe.detachFailure(key)
            .request();
    }
    public childRelease(key: string) {
        return this.service
            .childConnection()
            .runtimeProbe.release(key)
            .request();
    }
    public releaseAll(): void {
        this.service.releaseAll();
    }
    public childEcho(value: unknown) {
        return this.service
            .childConnection()
            .runtimeProbe.echo(value)
            .request();
    }
    public state() {
        return {
            entered: [...this.service.entered],
            notifications: [...this.service.notifications]
        };
    }
    public notify(value: unknown): void {
        this.service.notifications.push(value);
    }
    public callback(value: unknown) {
        return this.service
            .connection(this.sender)
            .runtimeProbe.echo(value)
            .request();
    }
    public setIdentity(identity: string): void {
        this.service.identity = identity;
    }
    public identity(): string {
        return this.service.identity;
    }
    public setCallerIdentity(identity: string) {
        return this.service
            .connection(this.sender)
            .runtimeProbe.setIdentity(identity)
            .request();
    }
    public async callerIdentityAfterHold(key: string): Promise<string> {
        await this.service.hold(key);
        return this.service
            .connection(this.sender)
            .runtimeProbe.identity()
            .request();
    }
    public async heldCallback(key: string, value: unknown) {
        await this.service.hold(key);
        return this.service
            .connection(this.sender)
            .runtimeProbe.echo(value)
            .request();
    }
    public bytes(value: ArrayBuffer): number[] {
        return [...new Uint8Array(value)];
    }
}
