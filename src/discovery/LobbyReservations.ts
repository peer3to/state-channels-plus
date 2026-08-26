import { AdId, AdKind } from "@/discovery/ChannelAd";

/**
 * A live acceptor-side hold on one ad. `channelId` is the ad's channelId at
 * the moment of accept (for an OPEN ad this is a *proposed*
 * channelId, adopted by the acquirer only after the accept - the ad's
 * channelId field is not binding at publish time).
 */
export type Reservation = {
    adId: AdId;
    peerAddress: string;
    channelId: string;
    kind: AdKind;
    reservedAtMs: number;
};

type LobbyReservationsDeps = {
    now: () => number;
    holdMs: number;
    onExpire: (reservation: Reservation) => void;
};

/**
 * Pure reservation state machine: at most ONE hold at a time,
 * on its own hold timer, independent of the negotiation timeout. No sockets,
 * no admission policy, no negotiation-service access - LobbyService owns all
 * of the wiring around this. The clock is injected so callers can drive
 * `reservedAtMs` deterministically in unit tests.
 */
export class LobbyReservations {
    private readonly now: () => number;
    private readonly holdMs: number;
    private readonly onExpire: (reservation: Reservation) => void;
    private held: Reservation | undefined;
    private expireHandle: ReturnType<typeof setTimeout> | undefined;

    constructor(deps: LobbyReservationsDeps) {
        this.now = deps.now;
        this.holdMs = deps.holdMs;
        this.onExpire = deps.onExpire;
    }

    public get current(): Reservation | undefined {
        return this.held;
    }

    /**
     * SECURITY/CORRECTNESS: a hold already in progress is never overwritten
     * or queued - a second reserve() while one is live declines with "busy"
     * and leaves the existing hold untouched.
     */
    public reserve(r: {
        adId: AdId;
        peerAddress: string;
        channelId: string;
        kind: AdKind;
    }): { ok: true; holdMs: number } | { ok: false; reason: "busy" } {
        if (this.held !== undefined) {
            return { ok: false, reason: "busy" };
        }
        this.held = { ...r, reservedAtMs: this.now() };
        this.expireHandle = setTimeout(() => this.expire(), this.holdMs);
        return { ok: true, holdMs: this.holdMs };
    }

    /**
     * Releases the current hold iff it matches `adId`. Returns false (never
     * throws) for an unknown/already-released/mismatched adId.
     */
    public release(adId: AdId): boolean {
        if (this.held === undefined || this.held.adId !== adId) {
            return false;
        }
        this.clearTimer();
        this.held = undefined;
        return true;
    }

    /** Clears the timer and drops the hold with no side effects (teardown only - never fires onExpire). */
    public dispose(): void {
        this.clearTimer();
        this.held = undefined;
    }

    private expire(): void {
        this.expireHandle = undefined;
        const expired = this.held;
        this.held = undefined;
        if (expired !== undefined) {
            this.onExpire(expired);
        }
    }

    private clearTimer(): void {
        if (this.expireHandle !== undefined) {
            clearTimeout(this.expireHandle);
            this.expireHandle = undefined;
        }
    }
}
