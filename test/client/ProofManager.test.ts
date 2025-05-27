import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import {
    ProofStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import ProofManager from "@/ProofManager";
import AgreementManager from "@/agreementManager";
import { EvmUtils } from "@/utils";
import * as factory from "../factory";
import { AddressLike, Signer } from "ethers";

describe("ProofManager", () => {
    let agreementManager: AgreementManager;
    let proofManager: ProofManager;

    before(() => {
        agreementManager = factory.agreementManager();
        proofManager = new ProofManager(agreementManager);
    });

    describe("encode/decode", () => {
        it("should correctly encode and decode proof", () => {});
    });

    describe("proofs creation", () => {
        describe("createDoubleSignProof", () => {});
    });

    describe("validators", () => {
        let signers: any[];
        let signer1: Signer;
        let signer2: Signer;
        let participant1: AddressLike;
        let participant2: AddressLike;

        before(async () => {
            signers = await ethers.getSigners();
            signer1 = signers[0];
            signer2 = signers[1];
            participant1 = await signer1.getAddress();
            participant2 = await signer2.getAddress();
        });

        describe("filterValidProofs", () => {
            it("should return an empty array if no proofs are provided", () => {});

            it("should filter out invalid proofs", () => {});

            it("should throw an error for unknown proof types", () => {});
        });
    });
});
