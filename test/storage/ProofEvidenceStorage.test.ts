import * as factory from "../factory";
import { StateSnapshot } from "@/models";
import Storage from "@/storage";
import type { ProofEvidence } from "@/types/disputes";
import { recordingLogger } from "@test/fixtures/node/RecordingLogger";
import { expect } from "chai";
import { ethers } from "ethers";
import { describe, it } from "mocha";

// the sync key the evidence store design fixes: `sync:<finalizedSnapshotHash>`
function expectedSyncKey(evidence: ProofEvidence): string {
    return `sync:${StateSnapshot.from(evidence.proof.finalizedSnapshot).hash}`;
}

describe("ProofEvidenceStorage", () => {
    it("holds no evidence before any is set", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();

        expect(proofEvidence.get(`dispute:${factory.hash()}`)).to.equal(
            undefined
        );
        expect(proofEvidence.getForkEvidence(forkId)).to.deep.equal([]);
    });

    it("returns the audit evidence set for its dispute under the dispute key", () => {
        const proofEvidence = new Storage().proofEvidence;
        const disputeHash = factory.hash();
        const evidence = factory.proofEvidence(factory.hash(), 2);

        const key = proofEvidence.setAuditEvidence(disputeHash, evidence);

        expect(key).to.equal(`dispute:${disputeHash}`);
        expect(proofEvidence.get(`dispute:${disputeHash}`)).to.deep.equal(
            evidence
        );
    });

    it("returns the sync evidence set under its proof's finalized snapshot key", () => {
        const proofEvidence = new Storage().proofEvidence;
        const evidence = factory.proofEvidence(factory.hash(), 2);

        const key = proofEvidence.setSyncEvidence(evidence);

        expect(key).to.equal(expectedSyncKey(evidence));
        expect(proofEvidence.get(expectedSyncKey(evidence))).to.deep.equal(
            evidence
        );
    });

    it("replaces the audit evidence of the same dispute with the later one", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();
        const disputeHash = factory.hash();
        const later = factory.proofEvidence(forkId, 2);

        proofEvidence.setAuditEvidence(
            disputeHash,
            factory.proofEvidence(forkId, 1)
        );
        proofEvidence.setAuditEvidence(disputeHash, later);

        expect(proofEvidence.get(`dispute:${disputeHash}`)).to.deep.equal(
            later
        );
        expect(proofEvidence.getForkEvidence(forkId)).to.deep.equal([later]);
    });

    it("replaces the sync evidence of the same finalized snapshot even when the fork is at the bound", () => {
        const { logger, entries } = recordingLogger("warn");
        const proofEvidence = new Storage(2, logger).proofEvidence;
        const forkId = factory.hash();
        const first = factory.proofEvidence(forkId, 1);
        const second = factory.proofEvidence(forkId, 2);
        const laterLatest = factory.proofEvidence(forkId, 1);
        // the same proof, a later latest point
        const firstUpdated: ProofEvidence = {
            ...first,
            latestSnapshot: laterLatest.latestSnapshot,
            encodedLatestState: laterLatest.encodedLatestState
        };

        proofEvidence.setSyncEvidence(first);
        proofEvidence.setSyncEvidence(second);
        const key = proofEvidence.setSyncEvidence(firstUpdated);

        expect(key).to.equal(expectedSyncKey(first));
        expect(proofEvidence.get(expectedSyncKey(first))).to.deep.equal(
            firstUpdated
        );
        expect(proofEvidence.getForkEvidence(forkId)).to.have.length(2);
        expect(entries()).to.deep.equal([]);
    });

    it("refuses a new sync record once its fork holds the maximum and logs the refusal", () => {
        const { logger, entries } = recordingLogger("warn");
        const proofEvidence = new Storage(2, logger).proofEvidence;
        const forkId = factory.hash();
        const first = factory.proofEvidence(forkId, 1);
        const second = factory.proofEvidence(forkId, 1);
        const refused = factory.proofEvidence(forkId, 1);

        proofEvidence.setSyncEvidence(first);
        proofEvidence.setSyncEvidence(second);
        expect(entries()).to.deep.equal([]);
        const key = proofEvidence.setSyncEvidence(refused);

        expect(key).to.equal(undefined);
        expect(proofEvidence.get(expectedSyncKey(refused))).to.equal(undefined);
        // refused, not evicting an earlier record
        expect(proofEvidence.get(expectedSyncKey(first))).to.deep.equal(first);
        expect(proofEvidence.get(expectedSyncKey(second))).to.deep.equal(
            second
        );
        const warnings = entries().filter((entry) => entry.level === "warn");
        expect(warnings).to.have.length(1);
        expect(warnings[0].meta[0]).to.deep.include({
            forkId,
            evidenceKey: expectedSyncKey(refused),
            maxSyncRecordsPerFork: 2
        });
    });

    it("bounds sync evidence per fork, so a full fork does not refuse another fork's record", () => {
        const proofEvidence = new Storage(1).proofEvidence;
        const fullForkId = factory.hash();
        const otherForkId = factory.hash();
        const otherEvidence = factory.proofEvidence(otherForkId, 1);

        proofEvidence.setSyncEvidence(factory.proofEvidence(fullForkId, 1));
        const key = proofEvidence.setSyncEvidence(otherEvidence);

        expect(key).to.equal(expectedSyncKey(otherEvidence));
        expect(proofEvidence.getForkEvidence(otherForkId)).to.deep.equal([
            otherEvidence
        ]);
    });

    it("does not count audit evidence toward the sync bound", () => {
        const proofEvidence = new Storage(2).proofEvidence;
        const forkId = factory.hash();
        const first = factory.proofEvidence(forkId, 1);
        const second = factory.proofEvidence(forkId, 1);

        proofEvidence.setAuditEvidence(
            factory.hash(),
            factory.proofEvidence(forkId, 1)
        );
        proofEvidence.setAuditEvidence(
            factory.hash(),
            factory.proofEvidence(forkId, 1)
        );

        expect(proofEvidence.setSyncEvidence(first)).to.equal(
            expectedSyncKey(first)
        );
        expect(proofEvidence.setSyncEvidence(second)).to.equal(
            expectedSyncKey(second)
        );
        expect(proofEvidence.getForkEvidence(forkId)).to.have.length(4);
    });

    it("never refuses or evicts audit evidence when the fork's sync evidence is at the bound", () => {
        const proofEvidence = new Storage(1).proofEvidence;
        const forkId = factory.hash();
        const earlierDisputeHash = factory.hash();
        const laterDisputeHash = factory.hash();
        const earlierAudit = factory.proofEvidence(forkId, 1);
        const laterAudit = factory.proofEvidence(forkId, 2);

        proofEvidence.setAuditEvidence(earlierDisputeHash, earlierAudit);
        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 1));
        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 1));
        proofEvidence.setAuditEvidence(laterDisputeHash, laterAudit);

        expect(
            proofEvidence.get(`dispute:${earlierDisputeHash}`)
        ).to.deep.equal(earlierAudit);
        expect(proofEvidence.get(`dispute:${laterDisputeHash}`)).to.deep.equal(
            laterAudit
        );
        expect(proofEvidence.getForkEvidence(forkId)).to.have.length(3);
    });

    it("keeps audit and sync evidence apart when the dispute hash equals the finalized snapshot hash", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();
        const syncEvidence = factory.proofEvidence(forkId, 1);
        const auditEvidence = factory.proofEvidence(forkId, 2);
        const sharedHash = StateSnapshot.from(
            syncEvidence.proof.finalizedSnapshot
        ).hash;

        proofEvidence.setSyncEvidence(syncEvidence);
        proofEvidence.setAuditEvidence(sharedHash, auditEvidence);

        expect(proofEvidence.get(`sync:${sharedHash}`)).to.deep.equal(
            syncEvidence
        );
        expect(proofEvidence.get(`dispute:${sharedHash}`)).to.deep.equal(
            auditEvidence
        );
    });

    it("returns every audit and sync record of a fork and none of another fork", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();
        const otherForkId = factory.hash();
        const audit = factory.proofEvidence(forkId, 1);
        const sync = factory.proofEvidence(forkId, 2);

        proofEvidence.setAuditEvidence(factory.hash(), audit);
        proofEvidence.setSyncEvidence(sync);
        proofEvidence.setSyncEvidence(factory.proofEvidence(otherForkId, 1));

        expect(proofEvidence.getForkEvidence(forkId)).to.have.deep.members([
            audit,
            sync
        ]);
    });

    it("returns only the audit records of a fork as its audit evidence: its sync records and another fork's audit records are left out", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();
        const otherForkId = factory.hash();
        const audit = factory.proofEvidence(forkId, 1);
        const laterAudit = factory.proofEvidence(forkId, 2);

        proofEvidence.setAuditEvidence(factory.hash(), audit);
        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 3));
        proofEvidence.setAuditEvidence(factory.hash(), laterAudit);
        proofEvidence.setAuditEvidence(
            factory.hash(),
            factory.proofEvidence(otherForkId, 1)
        );

        expect(proofEvidence.getForkAuditEvidence(forkId)).to.have.deep.members(
            [audit, laterAudit]
        );
    });

    it("drops a fork's audit and sync evidence and keeps another fork's", () => {
        const proofEvidence = new Storage().proofEvidence;
        const droppedForkId = factory.hash();
        const keptForkId = factory.hash();
        const droppedDisputeHash = factory.hash();
        const keptDisputeHash = factory.hash();
        const droppedSync = factory.proofEvidence(droppedForkId, 1);
        const keptAudit = factory.proofEvidence(keptForkId, 1);
        const keptSync = factory.proofEvidence(keptForkId, 2);

        proofEvidence.setAuditEvidence(
            droppedDisputeHash,
            factory.proofEvidence(droppedForkId, 1)
        );
        proofEvidence.setSyncEvidence(droppedSync);
        proofEvidence.setAuditEvidence(keptDisputeHash, keptAudit);
        proofEvidence.setSyncEvidence(keptSync);
        proofEvidence.dropFork(droppedForkId);

        expect(proofEvidence.get(`dispute:${droppedDisputeHash}`)).to.equal(
            undefined
        );
        expect(proofEvidence.get(expectedSyncKey(droppedSync))).to.equal(
            undefined
        );
        expect(proofEvidence.getForkEvidence(droppedForkId)).to.deep.equal([]);
        expect(proofEvidence.get(`dispute:${keptDisputeHash}`)).to.deep.equal(
            keptAudit
        );
        expect(proofEvidence.get(expectedSyncKey(keptSync))).to.deep.equal(
            keptSync
        );
    });

    it("accepts sync evidence of a dropped fork again up to the bound", () => {
        const proofEvidence = new Storage(1).proofEvidence;
        const forkId = factory.hash();
        const afterDrop = factory.proofEvidence(forkId, 1);

        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 1));
        proofEvidence.dropFork(forkId);
        const key = proofEvidence.setSyncEvidence(afterDrop);

        expect(key).to.equal(expectedSyncKey(afterDrop));
        expect(proofEvidence.getForkEvidence(forkId)).to.deep.equal([
            afterDrop
        ]);
    });

    it("keeps stored evidence unchanged when the caller mutates the value it set or read", () => {
        const proofEvidence = new Storage().proofEvidence;
        const disputeHash = factory.hash();
        const evidence = factory.proofEvidence(factory.hash(), 1);
        const expected = structuredClone(evidence);

        proofEvidence.setAuditEvidence(disputeHash, evidence);
        evidence.proof.hops.pop();
        proofEvidence.get(`dispute:${disputeHash}`)!.encodedLatestState = "0x";

        expect(proofEvidence.get(`dispute:${disputeHash}`)).to.deep.equal(
            expected
        );
    });

    it("finds each snapshot a record holds by its hash: the anchor, every hop's, the final point and the latest point", () => {
        const proofEvidence = new Storage().proofEvidence;
        const evidence = factory.proofEvidence(factory.hash(), 2);
        const held = [
            evidence.proof.anchorSnapshot,
            ...evidence.proof.hops.map((hop) => hop.snapshot),
            evidence.proof.finalizedSnapshot,
            evidence.latestSnapshot
        ].map((struct) => StateSnapshot.from(struct));

        proofEvidence.setAuditEvidence(factory.hash(), evidence);

        for (const snapshot of held)
            expect(
                proofEvidence.getSnapshot(snapshot.hash)?.toStruct()
            ).to.deep.equal(snapshot.toStruct());
    });

    it("finds no snapshot for a hash no record holds, nor one of a dropped fork", () => {
        const proofEvidence = new Storage().proofEvidence;
        const forkId = factory.hash();
        const evidence = factory.proofEvidence(forkId, 1);
        const latestHash = StateSnapshot.from(evidence.latestSnapshot).hash;
        proofEvidence.setAuditEvidence(factory.hash(), evidence);

        expect(proofEvidence.getSnapshot(factory.hash())).to.equal(undefined);
        proofEvidence.dropFork(forkId);
        expect(proofEvidence.getSnapshot(latestHash)).to.equal(undefined);
    });

    it("finds the final and the latest state a record holds by their hashes", () => {
        const proofEvidence = new Storage().proofEvidence;
        const evidence = factory.proofEvidence(factory.hash(), 2);

        proofEvidence.setSyncEvidence(evidence);

        expect(
            proofEvidence.getStateMachineState(
                ethers.keccak256(evidence.proof.encodedFinalizedState)
            )
        ).to.equal(evidence.proof.encodedFinalizedState);
        expect(
            proofEvidence.getStateMachineState(
                ethers.keccak256(evidence.encodedLatestState)
            )
        ).to.equal(evidence.encodedLatestState);
    });

    it("never returns a state a record does not hold (0x), also for the hash of 0x", () => {
        const proofEvidence = new Storage().proofEvidence;
        const evidence = factory.proofEvidence(factory.hash(), 1);
        evidence.proof.encodedFinalizedState = "0x";

        proofEvidence.setAuditEvidence(factory.hash(), evidence);

        expect(
            proofEvidence.getStateMachineState(ethers.keccak256("0x"))
        ).to.equal(undefined);
    });

    it("storage reads a snapshot and a state kept only as proof evidence", () => {
        const storage = new Storage();
        const evidence = factory.proofEvidence(factory.hash(), 1);
        const latest = StateSnapshot.from(evidence.latestSnapshot);
        expect(storage.getSnapshotIncludingEvidence(latest.hash)).to.equal(
            undefined
        );

        storage.proofEvidence.setAuditEvidence(factory.hash(), evidence);

        expect(
            storage.getSnapshotIncludingEvidence(latest.hash)?.toStruct()
        ).to.deep.equal(latest.toStruct());
        expect(
            storage.getStateIncludingEvidence(latest.stateMachineStateHash)
        ).to.equal(evidence.encodedLatestState);
    });

    it("stops signing only on the fork it was stopped on", () => {
        const proofEvidence = new Storage().proofEvidence;
        const stoppedForkId = factory.hash();
        const otherForkId = factory.hash();
        expect(proofEvidence.hasStoppedSigning(stoppedForkId)).to.equal(false);

        proofEvidence.stopSigning(stoppedForkId);

        expect(proofEvidence.hasStoppedSigning(stoppedForkId)).to.equal(true);
        expect(proofEvidence.hasStoppedSigning(otherForkId)).to.equal(false);
    });

    it("never lifts a signing stop when the fork's evidence is written or another fork is dropped", () => {
        const proofEvidence = new Storage(1).proofEvidence;
        const forkId = factory.hash();
        const otherForkId = factory.hash();
        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 1));
        proofEvidence.stopSigning(forkId);

        // a refused sync record at the bound, an audit record and a drop of another fork
        proofEvidence.setSyncEvidence(factory.proofEvidence(forkId, 2));
        proofEvidence.setAuditEvidence(
            factory.hash(),
            factory.proofEvidence(forkId, 3)
        );
        proofEvidence.stopSigning(otherForkId);
        proofEvidence.dropFork(otherForkId);

        expect(proofEvidence.hasStoppedSigning(forkId)).to.equal(true);
        expect(proofEvidence.hasStoppedSigning(otherForkId)).to.equal(false);
    });

    it("drops a fork's signing stop with its evidence and keeps another fork's stop", () => {
        const proofEvidence = new Storage().proofEvidence;
        const droppedForkId = factory.hash();
        const keptForkId = factory.hash();
        proofEvidence.setSyncEvidence(factory.proofEvidence(droppedForkId, 1));
        proofEvidence.stopSigning(droppedForkId);
        proofEvidence.stopSigning(keptForkId);

        proofEvidence.dropFork(droppedForkId);

        expect(proofEvidence.hasStoppedSigning(droppedForkId)).to.equal(false);
        expect(proofEvidence.getForkEvidence(droppedForkId)).to.deep.equal([]);
        expect(proofEvidence.hasStoppedSigning(keptForkId)).to.equal(true);
    });

    it("storage stops signing on a fork this peer disputes or whose signing a synced proof stopped, and on no other fork", () => {
        const storage = new Storage();
        const disputedForkId = factory.hash();
        const stoppedForkId = factory.hash();
        const openForkId = factory.hash();

        storage.disputes.storeDisputedFork(disputedForkId, true);
        storage.proofEvidence.stopSigning(stoppedForkId);

        expect(storage.isSigningStopped(disputedForkId)).to.equal(true);
        expect(storage.isSigningStopped(stoppedForkId)).to.equal(true);
        expect(storage.isSigningStopped(openForkId)).to.equal(false);
    });

    it("storage signs again on a fork whose own dispute marker is rolled back, unless a synced proof stopped it there", () => {
        const storage = new Storage();
        const rolledBackForkId = factory.hash();
        const stoppedForkId = factory.hash();
        for (const forkId of [rolledBackForkId, stoppedForkId])
            storage.disputes.storeDisputedFork(forkId, true);
        storage.proofEvidence.stopSigning(stoppedForkId);

        for (const forkId of [rolledBackForkId, stoppedForkId])
            storage.disputes.storeDisputedFork(forkId, false);

        expect(storage.isSigningStopped(rolledBackForkId)).to.equal(false);
        expect(storage.isSigningStopped(stoppedForkId)).to.equal(true);
    });
});
