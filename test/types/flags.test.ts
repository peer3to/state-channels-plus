import {
    Status,
    isCommittedParticipantStatus,
    isEngagedStatus
} from "@/types/flags";
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

describe("isEngagedStatus", function () {
    it("classifies PENDING_PARTICIPANT", function () {
        expect(isEngagedStatus(Status.PENDING_PARTICIPANT)).to.equal(true);
    });
    it("classifies PARTICIPATING", function () {
        expect(isEngagedStatus(Status.PARTICIPATING)).to.equal(true);
    });
    it("classifies DISCOVERING", function () {
        expect(isEngagedStatus(Status.DISCOVERING)).to.equal(false);
    });
    it("classifies NOT_OPENED", function () {
        expect(isEngagedStatus(Status.NOT_OPENED)).to.equal(false);
    });
    it("classifies OPENED", function () {
        expect(isEngagedStatus(Status.OPENED)).to.equal(false);
    });
    it("classifies SYNCED", function () {
        expect(isEngagedStatus(Status.SYNCED)).to.equal(true);
    });
    it("rejects an unknown numeric status", function () {
        expect(isEngagedStatus(-1 as Status)).to.equal(false);
    });
});
