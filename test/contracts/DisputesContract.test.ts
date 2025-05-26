import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
import EvmStateMachine from "@/evm/EvmStateMachine";
import { MathStateMachine } from "@typechain-types";

describe("DisputesManagerContract", function () {
    let peerOne: any;
    let peerTwo: any;
    let peerThree: any;
    let DisputeManagerInstance: any;
    this.beforeAll(async function () {
        const [owner] = await ethers.getSigners();
    });

    // Block Fraud Proofs
    it("should handle double signing fraud proofs", async function () {});

    it("should handle invalid state transition fraud proofs", async function () {});

    it("should handle state transition out of gas fraud proofs", async function () {});

    it("should handle empty block fraud proofs", async function () {});

    // Dispute Fraud Proofs
    it("should handle not latest state fraud proofs", async function () {});

    it("should handle invalid dispute fraud proofs", async function () {});

    it("should handle dipsute out of gas", async function () {});

    it("should handle invalid output state fraud proofs", async function () {});

    it("should handle invalid state proofs", async function () {});

    it("should handle invalid exit channel block fraud proofs", async function () {});

    // recurrsive disputes
    it("should handle invalid recursive dispute proofs", async function () {});

    it("should handle invalid previous recursive dispute proofs", async function () {});

    // Timeout Fraud Proofs
    it("should handle timeout threshold fraud proofs", async function () {});

    it("should handle timeout prior invalid fraud proofs", async function () {});

    it("should handle timeout participant no next fraud proofs", async function () {});
});
