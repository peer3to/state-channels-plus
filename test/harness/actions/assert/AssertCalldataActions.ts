import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertCalldataActions {
    constructor(private readonly harness: PeerTestHarness) {}

    noCalldataPosted(): void {
        const totalPosted = this.harness.peerHandles.reduce((sum, peer) => {
            return (
                sum +
                this.harness.event.getEventCallCount(
                    peer.index,
                    "onPostedCalldata"
                )
            );
        }, 0);

        const totalBlockCalldata = this.harness.peerHandles.reduce(
            (sum, peer) => {
                return (
                    sum +
                    this.harness.event.getEventCallCount(
                        peer.index,
                        "onBlockCalldataPosted"
                    )
                );
            },
            0
        );

        if (totalPosted > 0 || totalBlockCalldata > 0) {
            throw new Error(
                `Expected no calldata to be posted, but onPostedCalldata: ${totalPosted}, onBlockCalldataPosted: ${totalBlockCalldata}`
            );
        }
    }

    async calldataPosted(options?: { timeoutMs?: number }): Promise<void> {
        const { timeoutMs = 5000 } = options || {};

        const condition = () => {
            return this.harness.peerHandles.some(
                (peer) =>
                    this.harness.event.getEventCallCount(
                        peer.index,
                        "onPostedCalldata"
                    ) > 0 ||
                    this.harness.event.getEventCallCount(
                        peer.index,
                        "onBlockCalldataPosted"
                    ) > 0
            );
        };

        if (condition()) {
            return;
        }

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `No calldata was posted within ${timeoutMs}ms`
        });
    }
}
