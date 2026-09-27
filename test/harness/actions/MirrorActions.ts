// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type {
    MirrorChainEvent,
    ObservableRead,
    MirrorReadFault,
    MirrorReadObservation,
    MirrorUpdate
} from "@test/fixtures/customRpc/harnessControl/services/mirror/MirrorService";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

/**
 * Local mirror versus chain staging for the local-first reads (see
 * `MirrorService`). Observation is record-only; every read still reaches the
 * real contract.
 */
export class MirrorActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private harness: PeerTestHarness<TCustomRpc>) {}

    private mirror(peerIndex: number) {
        return this.harness.control(this.harness.getPeer(peerIndex)).mirror;
    }

    /** Count and record the peer's local and chain `read` calls. */
    async observe(
        peerIndex: number,
        read: ObservableRead
    ): Promise<{
        observation: () => Promise<MirrorReadObservation>;
        restore: () => Promise<void>;
    }> {
        const mirror = () => this.mirror(peerIndex);
        await mirror().observeRead(read).request();
        return {
            observation: async () =>
                await mirror().getReadObservation(read).request(),
            restore: async () => {
                await mirror().restoreRead(read).request();
            }
        };
    }

    /** The next local `read` fails (observed reads only). */
    async failNextLocalRead(
        peerIndex: number,
        read: ObservableRead,
        fault: MirrorReadFault
    ): Promise<void> {
        await this.mirror(peerIndex).failNextLocalRead(read, fault).request();
    }

    /** The next chain `read` fails (observed reads only). */
    async failNextChainRead(
        peerIndex: number,
        read: ObservableRead,
        fault: MirrorReadFault
    ): Promise<void> {
        await this.mirror(peerIndex).failNextChainRead(read, fault).request();
    }

    /**
     * Serve the peer's chain `read` calls from the chain state one block
     * before the channel's latest `event` log. Returns that block.
     */
    async serveChainReadsBefore(
        peerIndex: number,
        read: ObservableRead,
        event: MirrorChainEvent
    ): Promise<number> {
        return await this.mirror(peerIndex)
            .serveChainReadsBefore(read, event)
            .request();
    }

    /**
     * The peer's local diamond stops applying `update` logs from now on; its
     * event handler, storage and block ingest keep running.
     */
    async holdUpdates(
        peerIndex: number,
        update: MirrorUpdate
    ): Promise<{
        heldCount: () => Promise<number>;
        /** Apply the held logs to the local diamond, in order. */
        release: () => Promise<number>;
    }> {
        const mirror = () => this.mirror(peerIndex);
        await mirror().holdUpdates(update).request();
        return {
            heldCount: async () =>
                await mirror().getHeldUpdateCount(update).request(),
            release: async () => await mirror().releaseUpdates(update).request()
        };
    }
}
