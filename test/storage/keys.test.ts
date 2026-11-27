import {
    auditEvidenceKey,
    coordinateKey,
    isSyncEvidenceKey,
    syncEvidenceKey
} from "@/storage/keys";
import { expect } from "chai";
import { ethers } from "ethers";

describe("coordinateKey", function () {
    it("preserves zero-height coordinates", function () {
        const forkId = ethers.id("coordinate-zero");
        expect(coordinateKey(forkId, 0)).to.equal(`${forkId}:0`);
    });
    it("separates positive heights and fork identities", function () {
        const forkId = ethers.id("coordinate-positive");
        expect(coordinateKey(forkId, 7)).to.equal(`${forkId}:7`);
        expect(coordinateKey(forkId, 7)).not.to.equal(coordinateKey(forkId, 8));
        expect(coordinateKey(forkId, 7)).not.to.equal(
            coordinateKey(ethers.id("other-fork"), 7)
        );
    });
});

describe("evidence keys", function () {
    it("keys audit evidence as dispute:<disputeHash>", function () {
        const disputeHash = ethers.id("audited-dispute");
        expect(auditEvidenceKey(disputeHash)).to.equal(
            `dispute:${disputeHash}`
        );
    });
    it("keys sync evidence as sync:<finalizedSnapshotHash>", function () {
        const finalizedSnapshotHash = ethers.id("finalized-snapshot");
        expect(syncEvidenceKey(finalizedSnapshotHash)).to.equal(
            `sync:${finalizedSnapshotHash}`
        );
    });
    it("tells sync evidence keys from audit evidence keys of the same hash", function () {
        const sharedHash = ethers.id("shared-hash");
        expect(isSyncEvidenceKey(`sync:${sharedHash}`)).to.equal(true);
        expect(isSyncEvidenceKey(`dispute:${sharedHash}`)).to.equal(false);
    });
});
