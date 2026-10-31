// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { HostProbeService, ProbeEcho } from "./HostProbeService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
import { config, type Config } from "@/utils/config";

export class HostProbeRpcMethods extends AInternalRpcMethods<HostProbeService> {
    public echo(value: string): ProbeEcho {
        const signerAddress = String(
            this.service.application().p2pManager.stateManager.signerAddress
        );
        this.service.echoes.push(value);
        return { value, signerAddress };
    }

    public getEchoes(): string[] {
        return [...this.service.echoes];
    }

    public fail(name: string, message: string, code: string): never {
        throw Object.assign(new Error(message), { name, code });
    }

    /** Never replies. */
    public hang(): Promise<never> {
        return new Promise<never>(() => undefined);
    }

    /** A value of the config module copy this probe was compiled with. */
    public readConfig(key: keyof Config): Config[keyof Config] {
        return config[key];
    }

    public emitProbeEvent(label: string, count: number): void {
        this.service.application().emitProbeEvent(label, count);
    }
}
