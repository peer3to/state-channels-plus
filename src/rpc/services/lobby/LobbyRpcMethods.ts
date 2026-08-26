import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type P2PManager from "@/P2PManager";
import type MainRpcService from "@/rpc/MainRpcService";
import type {
    ReleaseIntentResult,
    RequestIntentResult
} from "@/discovery/LobbyIntentTypes";

import type LobbyService from "./LobbyService";

export type LobbyCustomRpc = MainRpcService & { lobbyService: LobbyService };

export type LobbyP2PManager = P2PManager<LobbyCustomRpc>;

/**
 * Wire endpoints ONLY (AGENTS.md: the dispatcher routes by name, so every
 * method here — even a `private` one — is callable by a crafted payload).
 * All state and helpers live on `LobbyService`; each endpoint here only
 * resolves the sender's authenticated address (guaranteed non-empty for
 * anything that reaches here — `LobbyService`'s `HandshakeCompletedGuard`
 * rejects everything else) and forwards to it.
 */
export default class LobbyRpcMethods extends ARpcMethods<LobbyP2PManager> {
    constructor(
        transport: ATransport,
        private readonly service: LobbyService
    ) {
        super(transport, service.p2pManager);
    }

    /** Fire-and-forget: peer publishing/renewing one of its own ads. */
    public advertise(encodedAd: string): void {
        const from = this.service.resolveSenderAddress(this.senderTransport);
        if (!from) return;
        this.service.handleAdvertise(from, encodedAd);
    }

    /** Fire-and-forget: peer withdrawing one of its own ads. */
    public withdraw(adId: string): void {
        const from = this.service.resolveSenderAddress(this.senderTransport);
        if (!from) return;
        this.service.handleWithdraw(from, adId);
    }

    /** Request/response: requester asks US (the advertiser) for a hold on `encodedAd`. */
    public async requestIntent(
        encodedAd: string,
        amount: string
    ): Promise<RequestIntentResult> {
        const from = this.service.resolveSenderAddress(this.senderTransport);
        if (!from) return { accepted: false, reason: "policy" };
        return this.service.handleRequestIntent(from, encodedAd, amount);
    }

    /** Request/response - ACK'd, never fire-and-forget. */
    public async releaseIntent(adId: string): Promise<ReleaseIntentResult> {
        const from = this.service.resolveSenderAddress(this.senderTransport);
        if (!from) return { released: false };
        return this.service.handleReleaseIntent(from, adId);
    }
}
