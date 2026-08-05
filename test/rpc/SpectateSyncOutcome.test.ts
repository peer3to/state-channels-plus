import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { ethers as ethersLib } from "ethers";

import Clock from "@/Clock";
import { Codec, Type, hash as keccak } from "@/utils";
import { Status } from "@/types";
import type { SyncPayload } from "@/types";
import { StateSnapshot } from "@/models";
import type P2PManager from "@/P2PManager";
import SpectateService, {
    SyncRequest,
    SyncFailReason
} from "@/rpc/services/spectate/SpectateService";
import { hexString, randomAddress, blockConfirmation } from "@test/factory";

/**
 * Pins the sync outcome contract and the peer-provable-vs-ambiguous
 * punishment taxonomy at unit level. Every collaborator is a sinon
 * stub/spy on a hand-built p2pManager/stateManager double - never the
 * real StateManager/P2PManager - so these assertions are purely about
 * SpectateService's own decision logic (outcome shape + punishment
 * policy), not the collaborators it calls through.
 */

// ---- shared fixture builders -------------------------------------------

function makeFakeLogger() {
    const logger: any = {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        verbose: sinon.stub()
    };
    logger.child = sinon.stub().returns(logger);
    return logger;
}

/** Full-control StateSnapshot builder - avoids test/factory.ts's
 * `stateSnapshot()` override-merge (which drops fields when a partial
 * `snapshotData` override is supplied). */
function buildSnapshot(params: {
    forkId: string;
    blockHeight: number;
    stateMachineStateHash: string;
}): StateSnapshot {
    return StateSnapshot.from({
        snapshotData: {
            originForkId: hexString(32),
            stateMachineStateHash: params.stateMachineStateHash,
            participants: [randomAddress(), randomAddress()],
            latestInboundMessageBlockHash: hexString(32),
            latestInboundMessageBlockHeight: 0n,
            latestOutboundMessageBlockHash: hexString(32),
            latestOutboundMessageBlockHeight: 0n,
            totalDeposits: { amount: 0n, data: "0x" },
            totalWithdrawals: { amount: 0n, data: "0x" }
        },
        forkId: params.forkId,
        blockHeight: BigInt(params.blockHeight),
        timestamp: Math.floor(Date.now() / 1000)
    });
}

interface Harness {
    service: SpectateService;
    p2pManager: any;
    stateManager: any;
    logger: any;
    blacklist: sinon.SinonStub;
    abortSpy: sinon.SinonStub;
    getStatusStub: sinon.SinonStub;
    requestStub: sinon.SinonStub;
    onSpectateRequestStub: sinon.SinonStub;
    localDiamondContract: any;
    stateChannelManagerContract: any;
    storage: any;
    fetchOnChainSnapshotStub: sinon.SinonStub;
}

/** Builds a SpectateService wired to an entirely fake p2pManager/stateManager.
 * All chain-facing calls default to "everything is valid" so a single
 * override (per the acceptance table) is what drives each test scenario. */
function buildHarness(): Harness {
    const logger = makeFakeLogger();
    const blacklist = sinon.stub();
    const abortSpy = sinon.stub();
    const getStatusStub = sinon.stub().returns(Status.PARTICIPATING);

    const requestStub = sinon.stub();
    const onSpectateRequestStub = sinon
        .stub()
        .returns({ request: requestStub });

    const storage = {
        blocks: {
            getNextBlockHeight: sinon.stub().returns(5),
            getLatestBlock: sinon.stub().returns(undefined),
            getBlock: sinon.stub().returns(undefined),
            storeBlock: sinon.stub()
        },
        stateSnapshots: {
            storeStateSnapshot: sinon.stub()
        },
        stateMachineStates: {
            storeStateMachineState: sinon.stub()
        },
        inboundMessages: { store: sinon.stub() },
        outboundMessages: { store: sinon.stub() }
    };

    const localDiamondContract = {
        isGenesisSnapshotWithoutTimeCheck: sinon.stub().resolves(true),
        verifyOutboundMessageBlocks: sinon.stub().resolves(true),
        verifyMilestones: { staticCall: sinon.stub().resolves(true) },
        getUnfinalizedBlockConfirmationsFromStateProof: sinon
            .stub()
            .resolves([]),
        isKillPeriodExpired: sinon.stub(),
        isReduceChallengePeriodExpired: sinon.stub(),
        getDisputeWindows: sinon.stub(),
        reduceAndFinalize: sinon.stub(),
        getLatestBlockFromStateProof: sinon.stub(),
        persistDisputeWindow: sinon.stub(),
        pruneOutboundMessageBlocks: sinon.stub().resolves([])
    };

    const stateChannelManagerContract = {
        getDisputeWindowCreationTimestamp: sinon.stub().resolves(0n),
        verifyBalanceInvariantCheckSnapshot: {
            staticCall: sinon.stub().resolves(true)
        },
        multicall: { staticCall: sinon.stub().resolves(undefined) },
        interface: new ethersLib.Interface([]),
        getDisputeWindows: sinon.stub(),
        getStateSnapshot: sinon.stub()
    };

    const stateManager: any = {
        logger,
        timeConfig: { agreementTime: 30 },
        getStatus: getStatusStub,
        abort: abortSpy,
        diamondStateMachine: { localDiamondContract },
        stateChannelManagerContract,
        storage,
        withMutex: sinon.stub().callsFake(async (fn: () => any) => fn()),
        unsafeSetLatestState: sinon.stub().resolves(),
        getActiveStateHash: sinon.stub().resolves(hexString(32)),
        forkId: undefined,
        onBlockConfirmationStruct: sinon.stub().resolves(true)
    };

    const p2pManager: any = {
        stateManager,
        disconnectAndBlacklistPeerByEvmAddress: blacklist,
        remoteRpc: {
            spectateService: {
                onSpectateRequest: onSpectateRequestStub
            }
        }
    };

    const service = new SpectateService(p2pManager as unknown as P2PManager);

    const fetchOnChainSnapshotStub = sinon.stub(
        service,
        "fetchAndPersistOnChainSnapshot"
    );
    sinon.stub(service, "fetchAndPersistOnChainDisputeWindows").resolves();

    return {
        service,
        p2pManager,
        stateManager,
        logger,
        blacklist,
        abortSpy,
        getStatusStub,
        requestStub,
        onSpectateRequestStub,
        localDiamondContract,
        stateChannelManagerContract,
        storage,
        fetchOnChainSnapshotStub
    };
}

/** A minimal, fully-consistent SyncPayload: no dispute windows, no
 * milestones (so latestFinalizedSnapshot === latestForkGenesisSnapshot),
 * genesis fork == on-chain fork, genesis height == on-chain height. Every
 * check applySyncResponse computes *locally* (hash equality, fork
 * equality, height ordering) is satisfied; every check that goes through
 * a stubbed contract call defaults to "valid" in `buildHarness()`. */
function buildHappyPayload(): {
    syncPayload: SyncPayload;
    onChainSnapshot: StateSnapshot;
    forkId: string;
    genesisHeight: number;
    genesisStateHash: string;
} {
    const forkId = ethersLib.hexlify(ethersLib.randomBytes(32));
    const genesisHeight = 0;
    const genesisEncodedState = hexString(64);
    const genesisStateHash = keccak(genesisEncodedState);

    const onChainSnapshot = buildSnapshot({
        forkId,
        blockHeight: genesisHeight,
        stateMachineStateHash: hexString(32) as string
    });
    const genesisSnapshot = buildSnapshot({
        forkId,
        blockHeight: genesisHeight,
        stateMachineStateHash: genesisStateHash
    });

    const syncPayload: SyncPayload = {
        disputeWindows: [],
        latestForkGenesisSnapshot: genesisSnapshot.toStruct(),
        latestForkGenesisEncodedState: genesisEncodedState,
        stateProof: { milestones: [], signedBlocks: [] },
        milestoneSnapshots: [],
        latestFinalizedEncodedState: genesisEncodedState,
        outboundMessageBlocksUpToLatestGenesis: [],
        outboundMessageBlocksOfTheLatestFork: []
    };

    return {
        syncPayload,
        onChainSnapshot,
        forkId,
        genesisHeight,
        genesisStateHash
    };
}

function buildSyncRequest(overrides: Partial<SyncRequest> = {}): SyncRequest {
    return {
        channelId: hexString(32),
        initTime: Clock.getTimeInSeconds(),
        forkId: undefined,
        blockHeight: undefined,
        ...overrides
    };
}

async function driveApplySyncResponse(
    h: Harness,
    payload: SyncPayload,
    opts: { resumeMode: boolean; timeoutMs: number },
    syncRequestOverrides: Partial<SyncRequest> = {},
    peerAddress: string = randomAddress() as string
) {
    const encoded = Codec.encode(payload, Type.SyncPayload) as string;
    const syncRequest = buildSyncRequest(syncRequestOverrides);
    return h.service.applySyncResponse(peerAddress, syncRequest, encoded, opts);
}

before(async function () {
    // SpectateService reads Clock.getTimeInSeconds() internally (RTT calc);
    // Clock is a process-wide singleton that must be initialized against a
    // provider once before any of these tests run.
    await Clock.init(ethers.provider);
});

// =========================================================================
// OUTCOME MATRIX
// =========================================================================

describe("SpectateService - sync outcome matrix", function () {
    it("a successful sync returns {ok:true, confirmedForkId, confirmedHeight, localWasAhead}", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot, forkId } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.storage.blocks.getNextBlockHeight.returns(7);

        const outcome = await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(outcome).to.deep.equal({
            ok: true,
            confirmedForkId: forkId,
            confirmedHeight: 6,
            localWasAhead: false
        });
    });

    it("adopts an in-flight sync's outcome when targeting the same fork/height", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        const peerAddress = randomAddress();

        let resolveRequest!: (v: { encodedSyncPayload: string }) => void;
        h.requestStub.returns(
            new Promise((resolve) => {
                resolveRequest = resolve;
            })
        );

        const first = h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 30_000 },
            undefined,
            undefined
        );

        // Same target (both undefined/undefined) -> adoption, not collision.
        const second = h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 30_000 },
            undefined,
            undefined
        );

        resolveRequest({
            encodedSyncPayload: Codec.encode(
                syncPayload,
                Type.SyncPayload
            ) as string
        });

        const [firstOutcome, secondOutcome] = await Promise.all([
            first,
            second
        ]);

        expect(firstOutcome).to.deep.equal(secondOutcome);
        expect((firstOutcome as { ok: boolean }).ok).to.equal(true);
    });

    it("resolves in-flight-collision when the adopting caller's own timeout races the in-flight sync", async function () {
        this.timeout(5000);
        const h = buildHarness();
        const peerAddress = randomAddress();

        let resolveRequest!: (v: { encodedSyncPayload: string }) => void;
        h.requestStub.returns(
            new Promise((resolve) => {
                resolveRequest = resolve;
            })
        );

        // First call: long timeout, stays in-flight.
        const first = h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 30_000 },
            undefined,
            undefined
        );

        // Second call: same target, but its own timeout is tiny -> races
        // and loses without disturbing the underlying in-flight sync.
        const second = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 20 },
            undefined,
            undefined
        );

        expect(second).to.deep.equal({
            ok: false,
            reason: "in-flight-collision"
        });
        expect(h.service.isSyncInFlight(peerAddress)).to.equal(true);

        // Let the underlying sync settle so it doesn't leak past the test.
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        resolveRequest({
            encodedSyncPayload: Codec.encode(
                syncPayload,
                Type.SyncPayload
            ) as string
        });
        await first;
    });

    it("a request/transport failure resolves {ok:false, reason:'request-failed'}", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();
        h.requestStub.rejects(new Error("transport down"));

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 5000 },
            undefined,
            undefined
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "request-failed"
        });
    });

    it("RTT strictly exceeding the resume-mode timeout bound resolves rtt-exceeded", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);

        const outcome = await driveApplySyncResponse(
            h,
            syncPayload,
            { resumeMode: true, timeoutMs: 5000 }, // 5s bound
            { initTime: Clock.getTimeInSeconds() - 6 } // 6s RTT > 5s bound
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "rtt-exceeded"
        });
    });

    it("RTT under the resume-mode timeout bound does NOT trigger rtt-exceeded", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot, forkId } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.storage.blocks.getNextBlockHeight.returns(1);

        const outcome = await driveApplySyncResponse(
            h,
            syncPayload,
            { resumeMode: true, timeoutMs: 5000 }, // 5s bound
            { initTime: Clock.getTimeInSeconds() - 1 } // 1s RTT < 5s bound
        );

        expect(outcome).to.deep.equal({
            ok: true,
            confirmedForkId: forkId,
            confirmedHeight: 0,
            localWasAhead: false
        });
    });
});

// =========================================================================
// POLICY MATRIX - peer-provable vs ambiguous, resumeMode:true
// =========================================================================

describe("SpectateService - punishment policy matrix (resumeMode:true)", function () {
    it("malformed-payload (peer-provable): blacklists exactly once, never aborts", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress() as string;
        const syncRequest = buildSyncRequest();

        const outcome = await h.service.applySyncResponse(
            peerAddress,
            syncRequest,
            "0xdeadbeef", // undecodable as Type.SyncPayload
            { resumeMode: true, timeoutMs: 5000 }
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "malformed-payload"
        });
        expect(h.blacklist.callCount).to.equal(1);
        expect(h.blacklist.firstCall.args[0]).to.equal(peerAddress);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    it("invalid-proof (peer-provable): blacklists exactly once, never aborts", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.localDiamondContract.isGenesisSnapshotWithoutTimeCheck.resolves(
            false
        );

        const outcome = await driveApplySyncResponse(h, syncPayload, {
            resumeMode: true,
            timeoutMs: 5000
        });

        expect(outcome).to.deep.equal({ ok: false, reason: "invalid-proof" });
        expect(h.blacklist.callCount).to.equal(1);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    // Ambiguous reasons routed through `applySyncResponse` -> `failSync`.
    // Driven per-reason via the smallest override that reaches it.
    const ambiguousCases: Array<{
        reason: SyncFailReason;
        arrange: (h: Harness, payload: SyncPayload) => void;
    }> = [
        {
            reason: "chain-view-mismatch",
            arrange: (h) => {
                h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
                    1n
                );
            }
        },
        {
            reason: "storage-conflict",
            arrange: (h) => {
                sinon
                    .stub(h.service, "persistSyncPayload")
                    .resolves({ outcome: "conflict" });
            }
        },
        {
            reason: "pipeline-rejected",
            arrange: (h) => {
                h.localDiamondContract.getUnfinalizedBlockConfirmationsFromStateProof.resolves(
                    [blockConfirmation()]
                );
                h.stateManager.onBlockConfirmationStruct.resolves(false);
            }
        },
        {
            reason: "internal-error",
            arrange: (h) => {
                sinon
                    .stub(h.service, "persistSyncPayload")
                    .resolves({ outcome: "incomplete", error: new Error("x") });
            }
        }
    ];

    for (const { reason, arrange } of ambiguousCases) {
        it(`${reason} (ambiguous, via failSync): never blacklists, never aborts, warns exactly once`, async function () {
            const h = buildHarness();
            const { syncPayload, onChainSnapshot } = buildHappyPayload();
            h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
            arrange(h, syncPayload);

            const outcome = await driveApplySyncResponse(h, syncPayload, {
                resumeMode: true,
                timeoutMs: 5000
            });

            expect((outcome as { ok: boolean }).ok).to.equal(false);
            expect((outcome as { reason: SyncFailReason }).reason).to.equal(
                reason
            );
            expect(
                h.blacklist.callCount,
                "blacklist must never be called for an ambiguous reason"
            ).to.equal(0);
            expect(
                h.abortSpy.callCount,
                "stateManager.abort must never be called for an ambiguous reason"
            ).to.equal(0);
            expect(
                h.logger.warn.callCount,
                "expected exactly one warn-level log for this ambiguous failure"
            ).to.equal(1);
        });
    }

    it("rtt-exceeded (ambiguous, via failSync): never blacklists, never aborts, warns exactly once", async function () {
        const h = buildHarness();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);

        const outcome = await driveApplySyncResponse(
            h,
            syncPayload,
            { resumeMode: true, timeoutMs: 5000 }, // 5s bound
            { initTime: Clock.getTimeInSeconds() - 6 } // 6s RTT > 5s bound
        );

        expect(outcome).to.deep.equal({ ok: false, reason: "rtt-exceeded" });
        expect(
            h.blacklist.callCount,
            "blacklist must never be called for an ambiguous reason"
        ).to.equal(0);
        expect(
            h.abortSpy.callCount,
            "stateManager.abort must never be called for an ambiguous reason"
        ).to.equal(0);
        expect(
            h.logger.warn.callCount,
            "expected exactly one warn-level log for this ambiguous failure"
        ).to.equal(1);
    });

    // These two reasons never reach a real sync attempt (in-flight-collision)
    // or never reach applySyncResponse/failSync at all (request-failed) - both
    // are short-circuits inside runSync/syncAwaitable. Pinned separately so a
    // mismatch against the general ambiguous-reason policy above is visible
    // rather than silently absorbed into the loop.
    it("in-flight-collision (ambiguous, short-circuit path): never blacklists, never aborts, warns exactly once", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();

        // Occupy the in-flight slot with a different target so the second
        // call is a same-peer, different-target mismatch.
        h.requestStub.returns(new Promise(() => {})); // never resolves
        void h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 30_000 },
            undefined,
            undefined
        );

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 30_000 },
            undefined,
            123 // different target -> mismatch, not adoption
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "in-flight-collision"
        });
        expect(h.blacklist.callCount).to.equal(0);
        expect(h.abortSpy.callCount).to.equal(0);
        expect(h.logger.warn.callCount).to.equal(1);
    });

    it("request-failed (ambiguous, short-circuit path): never blacklists, never aborts, warns exactly once", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();
        h.requestStub.rejects(new Error("transport down"));

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 5000 },
            undefined,
            undefined
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "request-failed"
        });
        expect(h.blacklist.callCount).to.equal(0);
        expect(h.abortSpy.callCount).to.equal(0);
        expect(h.logger.warn.callCount).to.equal(1);
    });
});

// =========================================================================
// NON-RESUME PRESERVATION - resumeMode:false, resume window closed
// =========================================================================

describe("SpectateService - non-resume preservation (resumeMode:false, window closed)", function () {
    it("PARTICIPATING + peer-provable reason -> blacklist, not abort", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.PARTICIPATING);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.localDiamondContract.isGenesisSnapshotWithoutTimeCheck.resolves(
            false
        );

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.blacklist.callCount).to.equal(1);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    it("PARTICIPATING + ambiguous reason -> blacklist, not abort", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.PARTICIPATING);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.blacklist.callCount).to.equal(1);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    it("NOT PARTICIPATING/PENDING + peer-provable reason -> stateManager.abort(), not blacklist", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.OPENED);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.localDiamondContract.isGenesisSnapshotWithoutTimeCheck.resolves(
            false
        );

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.abortSpy.callCount).to.equal(1);
        expect(h.blacklist.callCount).to.equal(0);
    });

    it("NOT PARTICIPATING/PENDING + ambiguous reason -> stateManager.abort(), not blacklist", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.OPENED);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.abortSpy.callCount).to.equal(1);
        expect(h.blacklist.callCount).to.equal(0);
    });
});

// =========================================================================
// RESUME-WINDOW GATE
// =========================================================================

describe("SpectateService - resume window gate", function () {
    it("resumeMode:false + window OPEN + ambiguous reason -> no blacklist, no abort", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.PARTICIPATING);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );

        h.service.enterResumeWindow();
        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.blacklist.callCount).to.equal(0);
        expect(h.abortSpy.callCount).to.equal(0);

        // After close, the SAME failure reverts to normal non-resume policy.
        h.service.exitResumeWindow();
        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });

        expect(h.blacklist.callCount).to.equal(1);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    it("nested enter/enter/exit keeps the window open until the SECOND exit", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.PARTICIPATING);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );

        h.service.enterResumeWindow();
        h.service.enterResumeWindow();
        h.service.exitResumeWindow(); // depth back to 1, still open

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });
        expect(h.blacklist.callCount).to.equal(0);
        expect(h.abortSpy.callCount).to.equal(0);

        h.service.exitResumeWindow(); // depth 0, closed

        await driveApplySyncResponse(h, syncPayload, {
            resumeMode: false,
            timeoutMs: 30_000
        });
        expect(h.blacklist.callCount).to.equal(1);
        expect(h.abortSpy.callCount).to.equal(0);
    });

    // The existing `abortSpy` assertions above (and throughout this file)
    // are hollow with respect to the resume-window gating itself: `abort()`
    // only ever reaches `stateManager.abort()` when status is NOT
    // PARTICIPATING/PENDING_PARTICIPANT, but every window-related test
    // above pins the harness at PARTICIPATING - so `stateManager.abort`
    // would be architecturally unreachable even if the gate were removed
    // entirely, and these assertions would pass identically against
    // reverted code. This test actually exercises the gate: with status
    // OPENED (abort()'s hard-nuke branch) AND resumeMode:true AND an
    // ambiguous failure, the resume-window/resume-mode policy must still
    // suppress `stateManager.abort()` - a fix regression here would flip
    // this from 0 to 1.
    it("resumeMode:true + status NOT PARTICIPATING/PENDING_PARTICIPANT + ambiguous reason -> stateManager.abort is NEVER called", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.OPENED);
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );

        const outcome = await driveApplySyncResponse(h, syncPayload, {
            resumeMode: true,
            timeoutMs: 30_000
        });

        expect((outcome as { ok: boolean }).ok).to.equal(false);
        expect(
            h.abortSpy.callCount,
            "stateManager.abort must never be reachable from a resume-mode failure, regardless of our own status"
        ).to.equal(0);
        expect(h.blacklist.callCount).to.equal(0);
    });

    // `runSync`'s own catch block (request/transport failure, BEFORE
    // applySyncResponse is ever reached) has its own copy of the
    // resume-window gating check (`opts.resumeMode || this.resumeWindowDepth
    // > 0`). No existing test in this file exercises that branch with
    // resumeMode:false + an open window - the review flagged this as
    // completely uncovered. Drives it via the public `sync()` entry point
    // (resumeMode:false) with a window opened externally via
    // `enterResumeWindow()`, and asserts neither blacklist nor abort fires.
    it("runSync catch-block: resumeMode:false + window OPEN + request failure -> no blacklist, no abort", async function () {
        const h = buildHarness();
        h.getStatusStub.returns(Status.PARTICIPATING);
        const peerAddress = randomAddress() as string;
        h.requestStub.rejects(new Error("transport down"));

        h.service.enterResumeWindow();
        try {
            h.service.sync(peerAddress, hexString(32));
            // `sync()` is fire-and-forget; flush the microtask queue (the
            // reject is already settled, so `runSync`'s catch body runs
            // synchronously from there) so the side effects have landed
            // before we assert.
            await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
            h.service.exitResumeWindow();
        }

        expect(
            h.blacklist.callCount,
            "a request/transport failure is ambiguous, not peer-provable - must not blacklist while the resume window is open"
        ).to.equal(0);
        expect(h.abortSpy.callCount).to.equal(0);
        expect(h.service.isSyncInFlight(peerAddress)).to.equal(false);
    });
});

// =========================================================================
// persistSyncPayload - the headline FR2 regression + already-current gating
// =========================================================================

describe("SpectateService - persistSyncPayload outcome contract", function () {
    it("FR2 REGRESSION: a write that completes but throws on unsafeSetLatestState returns 'incomplete', and a retry with the SAME payload returns 'applied' (never a false already-current)", async function () {
        const h = buildHarness();
        const { syncPayload } = buildHappyPayload();

        h.stateManager.unsafeSetLatestState = sinon
            .stub()
            .rejects(new Error("disk full"));
        h.storage.blocks.getLatestBlock.returns(undefined);

        const first = await h.service.persistSyncPayload(syncPayload);
        expect(first.outcome).to.equal("incomplete");
        if (first.outcome === "incomplete") {
            expect(first.error).to.be.instanceOf(Error);
        }

        // Simulate that the (idempotent) block/snapshot/state rows from the
        // failed attempt are now visible in storage, while the active
        // fork/state was never advanced (unsafeSetLatestState never
        // completed) - the exact shape of the FR2 bug.
        const finalizedHeight = Number(
            syncPayload.latestForkGenesisSnapshot.blockHeight
        );
        h.storage.blocks.getLatestBlock.returns({ height: finalizedHeight });
        h.stateManager.unsafeSetLatestState = sinon.stub().resolves();

        const second = await h.service.persistSyncPayload(syncPayload);
        expect(
            second.outcome,
            "must redo the write and report 'applied', not falsely short-circuit to 'already-current'"
        ).to.equal("applied");
    });

    it("'already-current' requires BOTH block-height-at-target AND an active-state proof - right fork, wrong hash still redoes the write", async function () {
        const h = buildHarness();
        const { syncPayload, forkId, genesisHeight } = buildHappyPayload();

        const finalizedHeight = genesisHeight;
        h.storage.blocks.getLatestBlock.returns({ height: finalizedHeight });
        h.stateManager.forkId = forkId; // right fork ...
        h.stateManager.getActiveStateHash = sinon
            .stub()
            .resolves(hexString(32)); // ... but wrong active-state hash

        const result = await h.service.persistSyncPayload(syncPayload);

        expect(result.outcome).to.equal("applied");
        expect(
            (h.stateManager.unsafeSetLatestState as sinon.SinonStub).callCount
        ).to.equal(1);
    });

    it("'already-current' IS returned when local blocks are at/above target height AND the active state hash matches", async function () {
        const h = buildHarness();
        const { syncPayload, forkId, genesisHeight, genesisStateHash } =
            buildHappyPayload();

        h.storage.blocks.getLatestBlock.returns({ height: genesisHeight });
        h.stateManager.forkId = forkId;
        h.stateManager.getActiveStateHash = sinon
            .stub()
            .resolves(genesisStateHash);

        const result = await h.service.persistSyncPayload(syncPayload);

        expect(result.outcome).to.equal("already-current");
        expect(
            (h.stateManager.unsafeSetLatestState as sinon.SinonStub).callCount
        ).to.equal(0);
    });
});

// =========================================================================
// IN-FLIGHT CLEANUP
// =========================================================================

describe("SpectateService - in-flight registry cleanup", function () {
    it("clears the in-flight entry after a successful sync", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.requestStub.resolves({
            encodedSyncPayload: Codec.encode(
                syncPayload,
                Type.SyncPayload
            ) as string
        });

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 5000 },
            undefined,
            undefined
        );

        expect((outcome as { ok: boolean }).ok).to.equal(true);
        expect(h.service.isSyncInFlight(peerAddress)).to.equal(false);
    });

    it("clears the in-flight entry after a failed sync", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();
        const { syncPayload, onChainSnapshot } = buildHappyPayload();
        h.fetchOnChainSnapshotStub.resolves(onChainSnapshot);
        h.stateChannelManagerContract.getDisputeWindowCreationTimestamp.resolves(
            1n
        );
        h.requestStub.resolves({
            encodedSyncPayload: Codec.encode(
                syncPayload,
                Type.SyncPayload
            ) as string
        });

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 5000 },
            undefined,
            undefined
        );

        expect((outcome as { ok: boolean }).ok).to.equal(false);
        expect(h.service.isSyncInFlight(peerAddress)).to.equal(false);
    });

    it("clears the in-flight entry after the request throws/rejects", async function () {
        const h = buildHarness();
        const peerAddress = randomAddress();
        h.requestStub.rejects(new Error("transport down"));

        const outcome = await h.service.syncAwaitable(
            peerAddress,
            hexString(32),
            { resumeMode: true, timeoutMs: 5000 },
            undefined,
            undefined
        );

        expect(outcome).to.deep.equal({
            ok: false,
            reason: "request-failed"
        });
        expect(h.service.isSyncInFlight(peerAddress)).to.equal(false);
    });
});
