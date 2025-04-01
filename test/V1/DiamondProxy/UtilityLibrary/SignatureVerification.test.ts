import { expect } from "chai";
import { ethers } from "hardhat";
import { BytesLike, Signer } from "ethers";
import { deployLibraryTestContract } from "@test/utils/testHelpers";
import { StateChannelUtilLibrary } from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("StateChannelUtilLibrary", function () {
    // We define a fixture to reuse the same setup in every test. We use
    // loadFixture to run this setup once, snapshot that state, and reset Hardhat
    // Network to that snapshot in every test.
    async function signMsg(
        msg: string,
        signer: Signer
    ): Promise<{ encodedMsg: BytesLike; signature: string }> {
        let encodedMsg = ethers.AbiCoder.defaultAbiCoder().encode(
            ["string"],
            [msg]
        );
        let encodedHash = ethers.keccak256(encodedMsg);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        let signature = await signer.signMessage(econdedHashBytes);
        return { encodedMsg, signature };
    }

    async function getSigners() {
        const signers = await ethers.getSigners();
        let firstSigner = signers[0];
        let secondSigner = signers[1];
        let thirdSigner = signers[2];
        return { firstSigner, secondSigner, thirdSigner, signers };
    }

    let libraryWrapper: StateChannelUtilLibrary;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;
    let thirdSigner: HardhatEthersSigner;

    this.beforeEach(async function () {
        libraryWrapper = await deployLibraryTestContract(ethers);
        let signers = await getSigners();
        firstSigner = signers.firstSigner;
        secondSigner = signers.secondSigner;
        thirdSigner = signers.thirdSigner;
    });

    describe("Signature Verification", function () {
        it("1 of 1 - Success", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [firstSigner.address],
                signed1.encodedMsg,
                [signed1.signature]
            );

            expect(result[0], "Signature verification failed").to.be.true;
        });
        it("1 of 1 - Wrong encoded message", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [firstSigner.address],
                signed1.encodedMsg + "00",
                [signed1.signature]
            );
            expect(
                result[0] == false &&
                result[1] == "Cryptography: Not enough valid signatures"
            ).to.be.true;
        });
        it("1 of 1 - No signature", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [firstSigner.address],
                signed1.encodedMsg + "00",
                []
            );
            expect(
                result[0] == false &&
                result[1] == "Cryptography: Not enought signatures provided"
            ).to.be.true;
        });
        it("1 of 1 - Invalid signature length", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);

            let resultPromise = libraryWrapper.verifyThresholdSigned(
                [firstSigner.address],
                signed1.encodedMsg,
                [signed1.signature + "00"]
            );
            await expect(resultPromise)
                .to.be.revertedWithCustomError(
                    libraryWrapper,
                    "ECDSAInvalidSignatureLength"
                )
                .withArgs(66);
        });
    });

    describe("Treshold Signature Verification", function () {
        it("3 of 3 inorder - success", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);
            let signed3 = await signMsg(msg, thirdSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [signed1.signature, signed2.signature, signed3.signature]
            );
            expect(result[0], "Threshold signature failed").to.be.true;
        });
        it("3 of 3 not inorder - success", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);
            let signed3 = await signMsg(msg, thirdSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [signed2.signature, signed3.signature, signed1.signature]
            );
            expect(result[0], "Threshold signature failed").to.be.true;
        });
        it("3 of 3 with more signatures not inorder - success", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);
            let signed3 = await signMsg(msg, thirdSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [
                    signed2.signature,
                    signed3.signature,
                    signed3.signature,
                    signed1.signature
                ]
            );
            expect(result[0], "Threshold signature failed").to.be.true;
        });
        it("2 of 3 - fail", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [signed1.signature, signed2.signature]
            );
            expect(
                result[0] == false &&
                result[1] ==
                "Cryptography: Not enought signatures provided",
                "Threshold signature failed"
            ).to.be.true;
        });
        it("2 of 3 with one duplicate signature - fail", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [signed1.signature, signed2.signature, signed1.signature]
            );
            expect(
                result[0] == false &&
                result[1] == "Cryptography: Not enough valid signatures",
                "Threshold signature failed"
            ).to.be.true;
        });
        it("3 of 3 with changed message - fail", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);

            let result = await libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg + "00",
                [signed1.signature, signed2.signature, signed1.signature]
            );
            expect(
                result[0] == false &&
                result[1] == "Cryptography: Not enough valid signatures",
                "Threshold signature failed"
            ).to.be.true;
        });
        it("2 of 3 with one invalid signature length - fail", async function () {
            let msg = "Hello peers!";
            let signed1 = await signMsg(msg, firstSigner);
            let signed2 = await signMsg(msg, secondSigner);

            let resultPromise = libraryWrapper.verifyThresholdSigned(
                [
                    firstSigner.address,
                    secondSigner.address,
                    thirdSigner.address
                ],
                signed1.encodedMsg,
                [signed1.signature, signed2.signature, signed1.signature + "00"]
            );
            await expect(resultPromise)
                .to.be.revertedWithCustomError(
                    libraryWrapper,
                    "ECDSAInvalidSignatureLength"
                )
                .withArgs(66);
        });
    });
});
