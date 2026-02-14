import { AssertSync } from "./AssertSync";
import { AssertSnapshot } from "./AssertSnapshot";
import { AssertDispute } from "./AssertDispute";
import { AssertCalldata } from "./AssertCalldata";
import { AssertRPC } from "./AssertRPC";

export { AssertSync };
export { AssertSnapshot };
export { AssertDispute };
export { AssertCalldata };
export { AssertRPC };

export class Assert {
    static allPeersInSync = AssertSync.allPeersInSync;
    static peersInSync = AssertSync.peersInSync;
    static blockHeight = AssertSync.blockHeight;
    static forkChanged = AssertSync.forkChanged;
    static forkUnchanged = AssertSync.forkUnchanged;
    static onlyHonestPeersInSync = AssertSync.onlyHonestPeersInSync;
    static maliciousPeerExcluded = AssertSync.maliciousPeerExcluded;
    static peerBlockHeightGreaterThan = AssertSync.peerBlockHeightGreaterThan;
    static participantCount = AssertSync.participantCount;

    static onChainSnapshotOnFork = AssertSnapshot.onChainSnapshotOnFork;
    static snapshotMatchesLocal = AssertSnapshot.snapshotMatchesLocal;
    static snapshotCountIncreasedSince =
        AssertSnapshot.snapshotCountIncreasedSince;
    static channelWithdrawalsMatchSnapshot =
        AssertSnapshot.channelWithdrawalsMatchSnapshot;
    static withdrawalDeltaMatchesExpected =
        AssertSnapshot.withdrawalDeltaMatchesExpected;
    static onChainBalanceMatchesSnapshot =
        AssertSnapshot.onChainBalanceMatchesSnapshot;

    static disputeCommittedByPeers = AssertDispute.disputeCommittedByPeers;
    static latestDisputeFraudProofStored =
        AssertDispute.latestDisputeFraudProofStored;
    static fraudProofStoredForTamperedDispute =
        AssertDispute.fraudProofStoredForTamperedDispute;
    static disputeInitiatedByPeers = AssertDispute.disputeInitiatedByPeers;
    static didNotInitiateDispute = AssertDispute.didNotInitiateDispute;
    static noDisputes = AssertDispute.noDisputes;
    static honestPeersInitiateDispute =
        AssertDispute.honestPeersInitiateDispute;
    static timeoutIsForced = AssertDispute.timeoutIsForced;

    static noCalldataPosted = AssertCalldata.noCalldataPosted;
    static calldataPosted = AssertCalldata.calldataPosted;

    static peerDisconnectedFrom = AssertRPC.peerDisconnectedFrom;
    static peerDisconnected = AssertRPC.peerDisconnected;
    static allPeersAcknowledgedDispute = AssertRPC.allPeersAcknowledgedDispute;
    static handshakeCompleted = AssertRPC.handshakeCompleted;
    static duplicateDisputeRequestIgnored =
        AssertRPC.duplicateDisputeRequestIgnored;
    static firstAcknowledgmentRecorded = AssertRPC.firstAcknowledgmentRecorded;
    static transportClosedOrGone = AssertRPC.transportClosedOrGone;
    static allHandshakesCompleted = AssertRPC.allHandshakesCompleted;
}
