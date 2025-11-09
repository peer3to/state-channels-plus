import { ChannelId, ForkId } from "@/types/types";
import { zeroHex } from "@test/factory";
import sinon from "sinon";

/**
 * Minimal test mock for StateChannelManagerContract
 *
 * Philosophy:
 * - Only stubs methods that tests explicitly configure
 * - Unconfigured methods throw explicit errors (no silent failures)
 * - This forces tests to be explicit about dependencies
 * - Reduces mock drift from real contract interface
 */
export class TestStateChannelManagerContract {
    // ===== CORE METHODS (stubbed, but throw by default) =====

    // State snapshot operations
    getStateSnapshot = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: getStateSnapshot() not configured for this test"
            )
        );
    updateStateSnapshotSameFork = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: updateStateSnapshotSameFork() not configured for this test"
            )
        );

    // Fork and dispute operations
    isForkDisputed = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: isForkDisputed() not configured for this test"
            )
        );
    getReducedResult = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: getReducedResult() not configured for this test"
            )
        );
    getWindowCommitments = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: getWindowCommitments() not configured for this test"
            )
        );

    // Transaction operations
    multicall = sinon
        .stub()
        .rejects(
            new Error("TestContract: multicall() not configured for this test")
        );

    // Reduction operations
    reduce = {
        staticCall: sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: reduce.staticCall() not configured for this test"
                )
            )
    };
    reduceAndFinalize = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: reduceAndFinalize() not configured for this test"
            )
        );

    // Kill period checks
    isKillPeriodExpired = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: isKillPeriodExpired() not configured for this test"
            )
        );

    // Block calldata operations
    getBlockCallDataCommitment = sinon.stub().resolves(zeroHex(32));

    // Contract interface for encoding function data
    interface = {
        encodeFunctionData: sinon
            .stub()
            .throws(
                new Error(
                    "TestContract: interface.encodeFunctionData() not configured for this test"
                )
            )
    };

    // ===== EVENT FILTERS =====
    filters = {
        BlockCalldataPosted: sinon.stub(),
        ChannelOpened: sinon.stub(),
        StateSnapshotUpdated: sinon.stub(),
        DisputeCommitted: sinon.stub(),
        ChainSlashed: sinon.stub(),
        DisputeReducedResultCommitted: sinon.stub(),
        DisputeCommittedWithAuditingData: sinon.stub(),
        WithdrawalsUpdated: sinon.stub(),
        ChannelStorageCleared: sinon.stub(),
        DisputeKilled: sinon.stub(),
        JoinChannelProcessed: sinon.stub()
    };

    // Query filter
    queryFilter = sinon
        .stub()
        .rejects(
            new Error(
                "TestContract: queryFilter() not configured for this test"
            )
        );

    // Event listeners
    on = sinon.stub();
    off = sinon.stub();

    // ===== INTERNAL STATE =====

    private forkDisputeConfigs: Map<ForkId, boolean> = new Map();
    private reducedResultConfigs: Map<
        ForkId,
        { reducedFork: ForkId; exists: boolean }
    > = new Map();

    // ===== BUILDER METHODS =====

    /**
     * Configure getStateSnapshot to return a specific snapshot
     */
    withStateSnapshot(snapshot: any): this {
        this.getStateSnapshot.resolves(snapshot);
        return this;
    }

    /**
     * Configure isForkDisputed for one or more forks
     */
    withForkDisputed(forkId: ForkId, disputed: boolean = true): this {
        this.forkDisputeConfigs.set(forkId, disputed);

        // Set up the fake function to check all configured forks
        this.isForkDisputed.callsFake((channelId: any, id: string) => {
            const config = this.forkDisputeConfigs.get(id);
            if (config === undefined) {
                return Promise.reject(
                    new Error(
                        `TestContract: isForkDisputed() called with unconfigured forkId: ${id}`
                    )
                );
            }
            return Promise.resolve(config);
        });
        return this;
    }

    /**
     * Configure getReducedResult for a fork
     */
    withReducedResult(
        forkId: ForkId,
        reducedFork: ForkId,
        exists: boolean = true
    ): this {
        this.reducedResultConfigs.set(forkId, { reducedFork, exists });

        // Set up the fake function to check all configured forks
        this.getReducedResult.callsFake((channelId: ChannelId, id: ForkId) => {
            const config = this.reducedResultConfigs.get(id);
            if (config === undefined) {
                return Promise.reject(
                    new Error(
                        `TestContract: getReducedResult() called with unconfigured forkId: ${id}`
                    )
                );
            }
            return Promise.resolve([
                config.exists ? config.reducedFork : null,
                config.exists
            ]);
        });
        return this;
    }

    /**
     * Configure multicall to return a transaction result
     */
    withMulticallResult(result: any = { wait: async () => ({}) }): this {
        this.multicall.resolves(result);
        return this;
    }

    /**
     * Configure updateStateSnapshotSameFork to return a transaction result
     */
    withUpdateStateSnapshotSameForkResult(
        result: any = { wait: async () => ({}) }
    ): this {
        this.updateStateSnapshotSameFork.resolves(result);
        return this;
    }

    /**
     * Configure getWindowCommitments to return commitments array
     */
    withWindowCommitments(commitments: any[] = []): this {
        this.getWindowCommitments.resolves(commitments);
        return this;
    }

    /**
     * Configure interface.encodeFunctionData to return encoded data
     */
    withEncodedFunctionData(encoded: string = "0xmockedcalldata"): this {
        this.interface.encodeFunctionData.returns(encoded);
        return this;
    }

    /**
     * Reset all stubs - useful between tests
     */
    reset(): void {
        sinon.reset();
        this.forkDisputeConfigs.clear();
        this.reducedResultConfigs.clear();

        // Re-initialize all stubs with error defaults
        this.getStateSnapshot = sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: getStateSnapshot() not configured for this test"
                )
            );
        this.updateStateSnapshotSameFork = sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: updateStateSnapshotSameFork() not configured for this test"
                )
            );
        this.isForkDisputed = sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: isForkDisputed() not configured for this test"
                )
            );
        this.getReducedResult = sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: getReducedResult() not configured for this test"
                )
            );
        this.multicall = sinon
            .stub()
            .rejects(
                new Error(
                    "TestContract: multicall() not configured for this test"
                )
            );
        this.getBlockCallDataCommitment = sinon.stub().resolves(zeroHex(32));
        this.interface.encodeFunctionData = sinon
            .stub()
            .throws(
                new Error(
                    "TestContract: interface.encodeFunctionData() not configured for this test"
                )
            );
        this.on = sinon.stub();
        this.off = sinon.stub();
    }
}
