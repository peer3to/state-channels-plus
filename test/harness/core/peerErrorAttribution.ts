import { AsyncLocalStorage } from "node:async_hooks";

import { DetachedPromises, maybeStampErrorWithPeerAddress } from "@/utils";
import type { HostHandlerExecutionContext } from "@/evm/p2pRuntime/HostHandlerExecutionContext";

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
 * Worker peers don't need this: one worker thread = one peer, so the
 * `P2pRuntimeClient` / `quiesceHosts` boundaries attribute errors directly.
 */
export class PeerIdentityExecutionContext
    implements HostHandlerExecutionContext
{
    // one store shared by all inline peers
    private static readonly currentPeerIdentityStorage = new AsyncLocalStorage<{
        peerAddress: string;
    }>();

    private static detachedRejectionStampingInstalled = false;

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
            { peerAddress: this.peerAddress },
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
     * address.
     */
    static installDetachedPromiseRejectionStamping(): void {
        if (PeerIdentityExecutionContext.detachedRejectionStampingInstalled) {
            return;
        }
        PeerIdentityExecutionContext.detachedRejectionStampingInstalled = true;

        const originalCollect = DetachedPromises.collect.bind(DetachedPromises);
        DetachedPromises.collect = (promise: Promise<unknown>): void => {
            const peerAddress =
                PeerIdentityExecutionContext.getPeerAddressOfCurrentAsyncContext();
            originalCollect(
                peerAddress
                    ? promise.catch((error: unknown) => {
                          maybeStampErrorWithPeerAddress(error, peerAddress);
                          throw error;
                      })
                    : promise
            );
        };
    }
}
