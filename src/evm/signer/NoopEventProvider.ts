import { AbstractProvider } from "ethers";
import type { Listener, ProviderEvent } from "ethers";

/**
 * Event-only provider stub for the main-thread runtime contract.
 *
 * Contract events are delivered through the event bus mirror
 * (`attachContractEvents` re-emits them on the contract), so ethers must not
 * spin up its own `getLogs` poller. But ethers'
 * `Contract.on(...)` refuses to register a subscription unless `runner.provider`
 * is set, and its subscription machinery calls `provider.on(filter, listener)`
 * under the hood. Every subscription entry point is a no-op so a local
 * subscription registers — and the re-emitted events reach it — without ever
 * starting a poll loop. (Overriding only `on` would leave `once`/`addListener`
 * inheriting `AbstractProvider`'s real polling subscriber.)
 */
class NoopEventProvider extends AbstractProvider {
    async on(_event: ProviderEvent, _listener: Listener): Promise<this> {
        return this;
    }

    async once(_event: ProviderEvent, _listener: Listener): Promise<this> {
        return this;
    }

    async addListener(
        _event: ProviderEvent,
        _listener: Listener
    ): Promise<this> {
        return this;
    }

    async off(_event: ProviderEvent, _listener?: Listener): Promise<this> {
        return this;
    }

    async removeListener(
        _event: ProviderEvent,
        _listener: Listener
    ): Promise<this> {
        return this;
    }

    async removeAllListeners(_event?: ProviderEvent): Promise<this> {
        return this;
    }
}

export default NoopEventProvider;
