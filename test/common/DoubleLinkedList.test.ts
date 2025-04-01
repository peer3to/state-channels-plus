import { expect } from "chai";
import { ethers } from "hardhat";
import { ContractTransactionResponse } from "ethers";
import { DoubleLinkedList } from "@typechain-types";

describe("DoubleLinkedList contract", function () {
    // We define a fixture to reuse the same setup in every test. We use
    // loadFixture to run this setup once, snapshot that state, and reset Hardhat
    // Network to that snapshot in every test.
    async function deployEmptyListFixture(): Promise<
        DoubleLinkedList & {
            deploymentTransaction(): ContractTransactionResponse;
        }
    > {
        const List = await ethers.getContractFactory("DoubleLinkedList");
        const list = await List.deploy();
        // await list.deployed();
        return list;
    }
    async function insertInitial(list: DoubleLinkedList) {
        let hexNumber = ethers.toBeHex(1);
        let bytes32Number = ethers.zeroPadValue(hexNumber, 32);
        let bytes32String1 = ethers.encodeBytes32String("1");
        let bytes32String2 = ethers.encodeBytes32String("2");

        await list.addFront({ tableId: bytes32Number });
        await list.addFront({ tableId: bytes32String1 });
        await list.addFront({ tableId: bytes32String2 });

        return { bytes32Number, bytes32String1, bytes32String2 };
    }

    describe("Insert", function () {
        it("Add elements front", async function () {
            const list = await deployEmptyListFixture();

            // expect(await greeter.greet()).to.equal("Hello, world!");

            const { bytes32Number, bytes32String1, bytes32String2 } =
                await insertInitial(list);

            expect(await list.length()).to.equal(3);

            // expect((await list.getNode(bytes32Number))).to.equal(ethers.utils.formatBytes32String("3"));
            let a1 = await list.getNode(bytes32Number);
            let a2 = await list.getNode(bytes32String1);
            let a3 = await list.getNode(bytes32String2);

            expect(a1.uniquePtr).to.equal(bytes32Number);
            expect(a2.uniquePtr).to.equal(bytes32String1);
            expect(a3.uniquePtr).to.equal(bytes32String2);
            await list.printAll();
            // wait until the transaction is mined
        });
    });
    describe("Remove", function () {
        it("Remove front", async function () {
            const list = await deployEmptyListFixture();
            const { bytes32Number, bytes32String1, bytes32String2 } =
                await insertInitial(list);

            let initialLength = await list.length();
            //first remove
            await list.removeFront();
            expect(--initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String1
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32Number
            );

            //second remove
            await list.removeFront();
            expect(--initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32Number
            );

            //third remove
            await list.removeFront();
            expect(--initialLength).to.equal(await list.length());

            // Add elements to see if list isn't broken

            //first add
            let bytes32String3 = ethers.encodeBytes32String("3");
            await list.addFront({ tableId: bytes32String3 });
            expect(++initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String3
            );

            //second add
            let bytes32String4 = ethers.encodeBytes32String("4");
            await list.addFront({ tableId: bytes32String4 });
            expect(++initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String4
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32String3
            );
        });
        it("Remove middle", async function () {
            const list = await deployEmptyListFixture();
            const { bytes32Number, bytes32String1, bytes32String2 } =
                await insertInitial(list);

            let initialLength = await list.length();
            //remove middle
            await list.removeNode(bytes32String1);
            expect(--initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String2
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32Number
            );

            // Add elements to see if list isn't broken

            //first add
            let bytes32String3 = ethers.encodeBytes32String("3");
            await list.addFront({ tableId: bytes32String3 });
            expect(++initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String3
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32String2
            );
            expect((await list.getAtIndex(2)).uniquePtr).to.equal(
                bytes32Number
            );
        });
        it("Remove last", async function () {
            const list = await deployEmptyListFixture();
            const { bytes32Number, bytes32String1, bytes32String2 } =
                await insertInitial(list);

            let initialLength = await list.length();
            //remove last
            await list.removeNode(bytes32Number);
            expect(--initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String2
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32String1
            );

            // Add elements to see if list isn't broken

            //first add
            let bytes32String3 = ethers.encodeBytes32String("3");
            await list.addFront({ tableId: bytes32String3 });
            expect(++initialLength).to.equal(await list.length());
            expect((await list.getAtIndex(0)).uniquePtr).to.equal(
                bytes32String3
            );
            expect((await list.getAtIndex(1)).uniquePtr).to.equal(
                bytes32String2
            );
            expect((await list.getAtIndex(2)).uniquePtr).to.equal(
                bytes32String1
            );
        });
    });
});
