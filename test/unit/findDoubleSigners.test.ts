import Block from "@/models/Block";
import { findDoubleSigners } from "@/stateManager/utils/findDoubleSigners";
import type { Address } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { expect } from "chai";
import type { ethers } from "ethers";

const FORK_ID = factory.hash();

/** A block at `height` of FORK_ID by `author` with `previousBlockHash`, confirmed by `coSigners`. */
async function signedBlock(
    author: ethers.Signer,
    coSigners: ethers.Signer[],
    options: { height: number; previousBlockHash: string }
): Promise<Block> {
    const block = Block.fromBlockConfirmation(
        Codec.decode(
            await factory.buildAndEncodeBlock(author, {
                header: { forkId: FORK_ID, transactionCnt: options.height },
                previousBlockHash: options.previousBlockHash
            }),
            Type.BlockConfirmation
        )
    );
    return block.expandSignatures(
        await Promise.all(coSigners.map((signer) => block.sign(signer)))
    );
}

const addressOf = (wallet: ethers.HDNodeWallet) => wallet.address as Address;

describe("Unit: findDoubleSigners", function () {
    it("two different blocks at one height → exactly the signers of both, author or co-signer; a signer of one block only is not one", async function () {
        const [alice, bob, carol, dave] = [1, 2, 3, 4].map(() =>
            factory.randomWallet()
        );
        const first = await signedBlock(alice, [bob, carol], {
            height: 5,
            previousBlockHash: factory.hash()
        });
        const second = await signedBlock(dave, [bob, alice], {
            height: 5,
            previousBlockHash: factory.hash()
        });

        const found = findDoubleSigners(
            first,
            second,
            addressOf(factory.randomWallet())
        );

        expect([...found].sort()).to.deep.equal(
            [addressOf(alice), addressOf(bob)].sort()
        );
    });

    it("the own address signed both blocks → it is not returned", async function () {
        const [alice, bob] = [1, 2].map(() => factory.randomWallet());
        const first = await signedBlock(alice, [bob], {
            height: 5,
            previousBlockHash: factory.hash()
        });
        const second = await signedBlock(alice, [bob], {
            height: 5,
            previousBlockHash: factory.hash()
        });

        expect([
            ...findDoubleSigners(first, second, addressOf(bob))
        ]).to.deep.equal([addressOf(alice)]);
    });

    it("the same signers on blocks at two heights → none", async function () {
        const [alice, bob] = [1, 2].map(() => factory.randomWallet());
        const previousBlockHash = factory.hash();
        const first = await signedBlock(alice, [bob], {
            height: 5,
            previousBlockHash
        });
        const second = await signedBlock(alice, [bob], {
            height: 6,
            previousBlockHash
        });

        expect(
            findDoubleSigners(first, second, addressOf(factory.randomWallet()))
                .size
        ).to.equal(0);
    });

    it("one block met twice, with more confirmations on one copy → none", async function () {
        const [alice, bob] = [1, 2].map(() => factory.randomWallet());
        const first = await signedBlock(alice, [], {
            height: 5,
            previousBlockHash: factory.hash()
        });
        const copy = Block.fromBlockConfirmation(first.blockConfirmationStruct);
        copy.expandSignatures([await copy.sign(bob)]);

        expect(
            findDoubleSigners(first, copy, addressOf(factory.randomWallet()))
                .size
        ).to.equal(0);
    });

    it("a confirmation that recovers no signer on one block → it names nobody and the real signers of both are still found", async function () {
        const [alice, bob] = [1, 2].map(() => factory.randomWallet());
        const first = await signedBlock(alice, [bob], {
            height: 5,
            previousBlockHash: factory.hash()
        });
        const second = await signedBlock(alice, [], {
            height: 5,
            previousBlockHash: factory.hash()
        });
        // a recovery id of 29: the contracts reject it, so it recovers no signer
        second.expandSignatures([`0x${"11".repeat(64)}1d`]);

        expect([
            ...findDoubleSigners(
                first,
                second,
                addressOf(factory.randomWallet())
            )
        ]).to.deep.equal([addressOf(alice)]);
    });
});
