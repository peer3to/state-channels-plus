// Worker RPC route names (req/res). Orchestrator calls via PeerCaller.call;
// worker registers handlers in opRoutes.
export const ROUTES = {
    query: {
        status: "query.status",
        blockAt: "query.blockAt",
        nextToWrite: "query.nextToWrite",
        participants: "query.participants",
        latestStateMachineStateHash: "query.latestStateMachineStateHash",
        nextBlockHeight: "query.nextBlockHeight",
        stateSnapshotAt: "query.stateSnapshotAt",
        stateMachineState: "query.stateMachineState",
        stateSnapshotCount: "query.stateSnapshotCount",
        isMyTurn: "query.isMyTurn",
        previousBlockHash: "query.previousBlockHash",
        stateSnapshotHashForFork: "query.stateSnapshotHashForFork",
        fraudProofForParticipant: "query.fraudProofForParticipant",
        disputeFraudProofs: "query.disputeFraudProofs",
        inboundLatestBlockHash: "query.inboundLatestBlockHash",
        inboundLatestBlockHeight: "query.inboundLatestBlockHeight",
        timeoutForFork: "query.timeoutForFork",
        disputeConfirmation: "query.disputeConfirmation",
        genesisSnapshot: "query.genesisSnapshot",
        stateSnapshotByHash: "query.stateSnapshotByHash",
        outboundMessageBlock: "query.outboundMessageBlock",
        previousStateSnapshot: "query.previousStateSnapshot",
        lastMilestoneSnapshot: "query.lastMilestoneSnapshot",
        blockConfirmationAt: "query.blockConfirmationAt",
        blockByHash: "query.blockByHash",
        latestBlockConfirmation: "query.latestBlockConfirmation",
        didEveryoneSignBlock: "query.didEveryoneSignBlock"
    },
    ingest: {
        blockConfirmation: "ingest.blockConfirmation"
    },
    timeout: {
        store: "timeout.store"
    },
    forceExit: {
        set: "forceExit.set"
    },
    context: {
        computeExpectedWithdrawalsDelta:
            "context.computeExpectedWithdrawalsDelta"
    },
    balance: {
        subtract: "balance.subtract",
        areEqual: "balance.areEqual",
        verifyInvariant: "balance.verifyInvariant"
    },
    dispute: {
        construct: "dispute.construct",
        latestBlockFromStateProof: "dispute.latestBlockFromStateProof",
        disputeWindows: "dispute.disputeWindows",
        localStateSnapshot: "dispute.localStateSnapshot",
        getAuditingData: "dispute.getAuditingData"
    },
    tx: {
        apply: "tx.apply"
    },
    snapshot: {
        post: "snapshot.post",
        prepareSameFork: "snapshot.prepareSameFork"
    },
    queue: {
        block: "queue.block"
    },
    p2p: {
        isBlacklisted: "p2p.isBlacklisted"
    },
    contract: {
        postBlockCalldata: "contract.postBlockCalldata"
    },
    byzantine: {
        stubCalldataHandler: "byzantine.stubCalldataHandler",
        restoreCalldataHandler: "byzantine.restoreCalldataHandler",
        stubPendingInboundInclusion: "byzantine.stubPendingInboundInclusion",
        restorePendingInboundInclusion:
            "byzantine.restorePendingInboundInclusion",
        stubBroadcast: "byzantine.stubBroadcast",
        broadcastBlockConfirmation: "byzantine.broadcastBlockConfirmation",
        submitDoubleSignBlock: "byzantine.submitDoubleSignBlock",
        storeStateMachineState: "byzantine.storeStateMachineState",
        storeStateSnapshot: "byzantine.storeStateSnapshot",
        corruptValidatorSnapshotForBalanceInvariant:
            "byzantine.corruptValidatorSnapshotForBalanceInvariant",
        installDisputeTamperHook: "byzantine.installDisputeTamperHook",
        uninstallDisputeTamperHook: "byzantine.uninstallDisputeTamperHook"
    },
    rpcStub: {
        installCreateRpcMethodStub: "rpcStub.installCreateRpcMethodStub",
        restoreCreateRpcMethodStub: "rpcStub.restoreCreateRpcMethodStub",
        restoreAll: "rpcStub.restoreAll"
    },
    queryInternals: {
        openConnections: "queryInternals.openConnections",
        getProfileByEvmAddress: "queryInternals.getProfileByEvmAddress",
        connectionCount: "queryInternals.connectionCount",
        isHandshakeCompletedWith: "queryInternals.isHandshakeCompletedWith",
        self: "queryInternals.self",
        isForkDisputedService: "queryInternals.isForkDisputedService",
        callServiceWithTransport: "queryInternals.callServiceWithTransport",
        callServiceMethodWithTransport:
            "queryInternals.callServiceMethodWithTransport",
        getPreferredTransportType: "queryInternals.getPreferredTransportType",
        getInitChallenge: "queryInternals.getInitChallenge",
        clearInitChallenge: "queryInternals.clearInitChallenge",
        getTransportStatus: "queryInternals.getTransportStatus",
        blockForkIsDisputed: "queryInternals.blockForkIsDisputed"
    },
    network: {
        disconnectAll: "network.disconnectAll",
        tryOpenConnectionToChannel: "network.tryOpenConnectionToChannel",
        installDisconnectFilter: "network.installDisconnectFilter"
    },
    math: {
        add: "math.add",
        sub: "math.sub",
        set: "math.set",
        leaveChannel: "math.leaveChannel"
    },
    lifecycle: {
        joinChannel: "lifecycle.joinChannel",
        connectToChannel: "lifecycle.connectToChannel",
        dispose: "lifecycle.dispose"
    },
    stub: {
        stubMethod: "stub.stubMethod"
    },
    spy: {
        reset: "spy.reset"
    }
} as const;

// Worker → orchestrator push topics (PeerHandler.push / PeerCaller.on).
export const PUSH_TOPICS = {
    forkChanged: "fork.changed",
    spy: "spy",
    lifecycleReady: "lifecycle.ready",
    lifecycleCrash: "lifecycle.crash",
    lifecycleDetachedRejection: "lifecycle.detachedRejection"
} as const;
