import { MAX_TX_GAS } from "@/types";
import { DeployUtils } from "@/utils/node/DeployUtils";
import { MathTestSession as TestSession } from "@test/harness";
import { slotDeployerIndex } from "@test/harness/core/slotAccounts";
import { expect } from "chai";
import fs from "fs";
import { ethers } from "hardhat";
import os from "os";
import path from "path";

describe("DeployUtils", function () {
    it("deploys the largest facet within the per-transaction gas cap and writes its address and ABI to a new contracts file", async function () {
        const h = TestSession.getHarness();
        await h.connectChain();
        const deployer = h.signerFor(slotDeployerIndex());
        const filePath = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "deploy-utils-")),
            "contracts.json"
        );
        const factory = await ethers.getContractFactory(
            "DisputeFraudProofFacet",
            deployer
        );

        const instance = await new DeployUtils(filePath).deployAsync(
            factory,
            "DisputeFraudProofFacet"
        );
        const receipt = await instance.deploymentTransaction()!.wait();

        const address = await instance.getAddress();
        expect(receipt?.status).to.equal(1);
        expect(
            instance.deploymentTransaction()!.gasLimit <= MAX_TX_GAS
        ).to.equal(true);
        expect(await deployer.provider!.getCode(address)).not.to.equal("0x");
        expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).to.deep.equal({
            DisputeFraudProofFacet: {
                address,
                abi: factory.interface.formatJson()
            }
        });
    });

    it("keeps the entries of an existing contracts file beside the new deploy", async function () {
        const h = TestSession.getHarness();
        await h.connectChain();
        const deployer = h.signerFor(slotDeployerIndex());
        const filePath = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "deploy-utils-")),
            "contracts.json"
        );
        const earlier = { Earlier: { address: ethers.ZeroAddress, abi: "[]" } };
        fs.writeFileSync(filePath, JSON.stringify(earlier));
        const factory = await ethers.getContractFactory(
            "UtilityFacet",
            deployer
        );

        const instance = await new DeployUtils(filePath).deployAsync(
            factory,
            "UtilityFacet"
        );

        expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).to.deep.equal({
            ...earlier,
            UtilityFacet: {
                address: await instance.getAddress(),
                abi: factory.interface.formatJson()
            }
        });
    });
});
