import * as sinon from "sinon";
import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import HolepunchTransport from "@/transport/HolepunchTransport";
import PunishmentRpcMethods from "./PunishmentRpcMethods";

// HolepunchTransport#_close lives on a SHARED prototype (every
// HolepunchTransport instance, across every peer in this process, uses the
// same function object) - the spy is installed exactly once per process,
// never once per peer, or a second peer's PunishmentService would wrap an
// already-wrapped method and double-count every real call. This is a
// call-through spy (sinon.spy on an assigned prototype method), not a
// monkey-patch: `_close`'s own behaviour (holepunchPeerInfo.ban(true) +
// socket.destroy()) is preserved unchanged, only observed.
let banSpyInstalled = false;
let banCallCount = 0;

function ensureBanSpyInstalled(): void {
    if (banSpyInstalled) return;
    banSpyInstalled = true;
    const original = HolepunchTransport.prototype._close;
    HolepunchTransport.prototype._close = function (
        this: HolepunchTransport
    ): void {
        banCallCount++;
        return original.call(this);
    };
}

/**
 * Observes the discovery-adjacent punishment primitives as REAL call counts
 * (backing the "zero blacklist/ban" assertion), not a vibe:
 * - `P2PManager#disconnectAndBlacklistPeerByEvmAddress` /
 *   `#disconnectAndBlacklistPeer` — spied on THIS peer's own p2pManager
 *   instance (never cross-peer).
 * - `HolepunchTransport#_close` (which calls `holepunchPeerInfo.ban(true)`) —
 *   process-wide, since HolepunchTransport shares one prototype across every
 *   peer; irrelevant under DEBUG_LOCAL_TRANSPORT (HolepunchTransport is never
 *   constructed there — LocalTransport is used instead) but wired for
 *   completeness/documentation.
 * Both are call-through `sinon.spy`s: real behaviour is preserved, only
 * observed — never a monkey-patch that changes what the SDK does.
 */
export class PunishmentService extends ARpcService<PunishmentRpcMethods> {
    private readonly blacklistByAddressSpy: sinon.SinonSpy;
    private readonly blacklistByTransportSpy: sinon.SinonSpy;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessPunishmentService"
            })
        );
        this.blacklistByAddressSpy = sinon.spy(
            p2pManager,
            "disconnectAndBlacklistPeerByEvmAddress"
        );
        this.blacklistByTransportSpy = sinon.spy(
            p2pManager,
            "disconnectAndBlacklistPeer"
        );
        ensureBanSpyInstalled();
    }

    public createRPCMethods(transport: ATransport): PunishmentRpcMethods {
        return new PunishmentRpcMethods(transport, this);
    }

    /** This peer's own blacklist call count (both entry points, summed). */
    public get blacklistCallCount(): number {
        return (
            this.blacklistByAddressSpy.callCount +
            this.blacklistByTransportSpy.callCount
        );
    }

    /** Process-wide `holepunchPeerInfo.ban(true)` call count. */
    public static get banCallCount(): number {
        return banCallCount;
    }

    /**
     * Resets only the process-wide ban COUNTER, not the spy itself: the
     * `_close` wrap installed by `ensureBanSpyInstalled` is permanent for
     * the process (call-through, never suppressed/reinstalled) - it keeps
     * observing every real `holepunchPeerInfo.ban(true)` for the rest of the
     * process's life. Call this in a test's `beforeEach`/`afterEach` so a
     * ban in one `it()` can't leak into a later zero-counter assertion in
     * the same file.
     */
    public static resetBanCallCount(): void {
        banCallCount = 0;
    }
}

export default PunishmentService;
