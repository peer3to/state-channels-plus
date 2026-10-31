// @spec-test-coverage-ignore: harness error attribution support; assertions belong to the calling test declarations
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";
import {
    DetachedPromises,
    maybeStampErrorWithPeerAddress,
    sleep
} from "@/utils";
import { AsyncLocalStorage } from "node:async_hooks";

// How long a cut runtime's pending work may still hold the session's drain
// or a disposal.
export const CUT_GRACE_MS = 5_000;

/**
 * Tags all of one inline peer's work with its EVM address.
 *
 * Inline peers share one process, so an escaping error can't be traced back
 * to a peer on its own. The harness passes one instance per peer into
 * `p2pSetup` (`handlerExecutionContext`); it runs every host handler inside an
 * AsyncLocalStorage scope holding the peer's address, and escaping errors get
 * stamped with it. `TestSession.setFirstDetachedError` uses the stamp to
 * ignore errors from byzantine/left-channel peers.
 *
 * The host root disposes its context at its disposal cut-off. Work the
 * context collected and still pending a grace period later stops holding
 * the session's drain: a send frozen at the cut never settles. Work failing
 * within the grace, such as an abort's own cause or a connect it answers
 * false, still surfaces.
 *
 * Worker peers don't need this: one worker thread = one peer, so the
 * `P2pRuntimeClientRoot` / `quiesceHosts` boundaries attribute errors directly.
 */
export class PeerIdentityExecutionContext
    implements HostHandlerExecutionContext
{
    // one store shared by all inline peers
    private static readonly currentPeerIdentityStorage = new AsyncLocalStorage<{
        peerAddress: string;
        context: PeerIdentityExecutionContext;
    }>();

    private static detachedRejectionStampingInstalled = false;

    private markDisposed!: () => void;
    // Resolves CUT_GRACE_MS after the runtime's cut-off.
    private readonly disposal = new Promise<void>((resolve) => {
        this.markDisposed = resolve;
    }).then(() => sleep(CUT_GRACE_MS));

    constructor(private readonly peerAddress: string) {}

    /**
     * Run one host handler invocation under this peer's identity.
     *
     * Errors escaping the handler are stamped here, at the throw boundary:
     * paths like EventSyncService collect the handler's promise from their
     * own polling context, where the collect-time stamping below can't see
     * the peer, so a late rejection would otherwise surface unattributed.
     */
    runHandler<T>(handlerBody: () => T): T {
        return PeerIdentityExecutionContext.currentPeerIdentityStorage.run(
            { peerAddress: this.peerAddress, context: this },
            () => {
                try {
                    const result = handlerBody();
                    if (result instanceof Promise) {
                        return result.catch((error: unknown) => {
                            maybeStampErrorWithPeerAddress(
                                error,
                                this.peerAddress
                            );
                            throw error;
                        }) as T;
                    }
                    return result;
                } catch (error) {
                    maybeStampErrorWithPeerAddress(error, this.peerAddress);
                    throw error;
                }
            }
        );
    }

    // Implements HostHandlerExecutionContext.dispose: the runtime is cut.
    dispose(): void {
        this.markDisposed();
    }

    /**
     * Address of the peer whose handler the caller is running under, if any.
     *
     * Covers floating rejections (`void somePromise`) that never went through
     * `DetachedPromises.collect`: Node runs `unhandledRejection` listeners in
     * the rejected promise's async context, so the unhandledRejection listener
     * can still read the peer here and stamp the error.
     */
    static getPeerAddressOfCurrentAsyncContext(): string | undefined {
        return PeerIdentityExecutionContext.currentPeerIdentityStorage.getStore()
            ?.peerAddress;
    }

    /**
     * Patch `DetachedPromises.collect` (once): a promise collected while a
     * peer's handler runs gets its eventual rejection stamped with that peer's
     * address, and counts as settled once that peer's runtime was cut a grace
     * period ago.
     */
    static installDetachedPromiseRejectionStamping(): void {
        if (PeerIdentityExecutionContext.detachedRejectionStampingInstalled) {
            return;
        }
        PeerIdentityExecutionContext.detachedRejectionStampingInstalled = true;

        const originalCollect = DetachedPromises.collect.bind(DetachedPromises);
        DetachedPromises.collect = (promise: Promise<unknown>): void => {
            const store =
                PeerIdentityExecutionContext.currentPeerIdentityStorage.getStore();
            originalCollect(
                store
                    ? Promise.race([
                          promise.catch((error: unknown) => {
                              maybeStampErrorWithPeerAddress(
                                  error,
                                  store.peerAddress
                              );
                              throw error;
                          }),
                          store.context.disposal
                      ])
                    : promise
            );
        };
    }
}
