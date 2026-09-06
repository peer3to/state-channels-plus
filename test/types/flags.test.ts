import { Status, isCommittedParticipantStatus } from "@/types/flags";
import { expect } from "chai";

describe("isCommittedParticipantStatus", function () {
    it("classifies PENDING_PARTICIPANT", function () {
        expect(
            isCommittedParticipantStatus(Status.PENDING_PARTICIPANT)
        ).to.equal(true);
    });
    it("classifies PARTICIPATING", function () {
        expect(isCommittedParticipantStatus(Status.PARTICIPATING)).to.equal(
            true
        );
    });
    it("classifies DISCOVERING", function () {
        expect(isCommittedParticipantStatus(Status.DISCOVERING)).to.equal(
            false
        );
    });
    it("classifies NOT_OPENED", function () {
        expect(isCommittedParticipantStatus(Status.NOT_OPENED)).to.equal(false);
    });
    it("classifies OPENED", function () {
        expect(isCommittedParticipantStatus(Status.OPENED)).to.equal(false);
    });
    it("classifies SYNCED", function () {
        expect(isCommittedParticipantStatus(Status.SYNCED)).to.equal(false);
    });
    it("rejects an unknown numeric status", function () {
        expect(isCommittedParticipantStatus(-1 as Status)).to.equal(false);
    });
});
