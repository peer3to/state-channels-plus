// @spec-test-coverage-ignore: double-sign block crafting and proof projections exercised by explicit ValidationService, SpectateSyncProofStart and block fraud proof declarations
import Block from "@/models/Block";
import type { Address, ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { buildAndEncodeBlock, hash as randomHash } from "@test/factory";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** The harness peer with `address`. */
function peerOf(h: MathPeerTestHarness, address: string): Peer {
    const peer = h.peers.find((candidate) => candidate.address === address);
    if (!peer) throw new Error(`No harness peer is ${address}`);
    return peer;
}

/** `block` with every address of `coSigners` added as a confirmation signer. */
async function coSign(
    h: MathPeerTestHarness,
    block: Block,
    coSigners: string[]
): Promise<Block> {
    return block.expandSignatures(
        await Promise.all(
            coSigners.map((address) => block.sign(peerOf(h, address).signer))
        )
    );
}

/**
 * An authentic block at `height` of `forkId` by `author`, confirmed by
 * `coSigners`, linked to `previousBlockHash` (a random hash when omitted,
 * so it links to nothing), committing no state transition result.
 */
export async function craftCoSignedBlock(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        height: number;
        author: string;
        coSigners: string[];
        previousBlockHash?: Hash;
    }
): Promise<Block> {
    const author = peerOf(h, options.author);
    const encoded = await buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId: options.forkId,
            transactionCnt: options.height,
            participant: author.address as Address
        },
        previousBlockHash: options.previousBlockHash ?? randomHash()
    });
    return coSign(
        h,
        Block.fromBlockConfirmation(
            Codec.decode(encoded, Type.BlockConfirmation)
        ),
        options.coSigners
    );
}

/**
 * A copy of `original` with `change` applied, signed by its author and
 * re-confirmed by every other signer of `original` that `keep` accepts.
 */
export async function resignedCopy(
    h: MathPeerTestHarness,
    original: Block,
    change: { previousBlockHash?: Hash; timestampOffset?: bigint },
    keep: (signer: string) => boolean = () => true
): Promise<Block> {
    const header = original.blockStruct.transaction.header;
    const copy = await Block.fromBlockStruct(
        {
            ...original.blockStruct,
            transaction: {
                ...original.blockStruct.transaction,
                header: {
                    ...header,
                    timestamp:
                        BigInt(header.timestamp) +
                        (change.timestampOffset ?? 0n)
                }
            },
            previousBlockHash:
                change.previousBlockHash ?? original.previousBlockHash
        },
        peerOf(h, String(original.author)).signer
    );
    return coSign(
        h,
        copy,
        [...original.confirmationSignerAddresses]
            .map(String)
            .filter(
                (signer) => signer !== String(original.author) && keep(signer)
            )
    );
}

/**
 * Per address, the block hashes of every BlockDoubleSign proof `peer`
 * stores against it.
 */
export async function doubleSignProofHashes(
    h: MathPeerTestHarness,
    peer: Peer,
    addresses: string[]
): Promise<Record<string, string[][]>> {
    const query = h.control(peer).query;
    const proofs: Record<string, string[][]> = {};
    for (const address of addresses)
        proofs[address] = await query
            .getDoubleSignProofBlockHashes(address as Address)
            .request();
    return proofs;
}

/**
 * A block at `height` of `forkId` conflicting with `observer`'s stored
 * block there: authored by a signer of that block other than the observer
 * and its author, and confirmed by another signer of it other than the
 * observer (plus the observer itself with `withOwnSignature`). Linked to
 * the stored block below with `linked`, else to nothing. Returns it with
 * its author, its co-signer and the stored block's signers.
 */
export async function craftCoSignedConflict(
    h: MathPeerTestHarness,
    observer: Peer,
    options: {
        forkId: ForkId;
        height: number;
        linked?: boolean;
        withOwnSignature?: boolean;
    }
) {
    const query = h.control(observer).query;
    const stored = (await query
        .getBlockByHeight(options.forkId, options.height)
        .request())!;
    const storedSigners = [stored.author, ...stored.confirmationSignerAddresses]
        .map(String)
        .sort();
    const others = storedSigners.filter(
        (signer) => signer !== observer.address
    );
    const author = others.find((signer) => signer !== stored.author)!;
    const coSigner = others.find((signer) => signer !== author)!;
    const previous = options.linked
        ? (await query
              .getBlockByHeight(options.forkId, options.height - 1)
              .request())!.hash
        : undefined;
    const block = await craftCoSignedBlock(h, {
        forkId: options.forkId,
        height: options.height,
        author,
        coSigners: options.withOwnSignature
            ? [coSigner, observer.address]
            : [coSigner],
        previousBlockHash: previous as Hash | undefined
    });
    return {
        encoded: Codec.encode(
            block.blockConfirmationStruct,
            Type.BlockConfirmation
        ) as string,
        hash: String(block.hash),
        storedHash: String(stored.hash),
        author,
        coSigner,
        storedSigners
    };
}

/**
 * The chain's slashes include `expected`, and every other slashed address
 * is a harness participant: a double signer whose proof an honest peer's
 * dispute may carry as well.
 */
export async function expectSlashedAtLeast(
    h: MathPeerTestHarness,
    expected: string[]
): Promise<void> {
    const slashed = (
        await h.channelManager.getOnChainSlashedParticipants(h.channelId)
    ).map(String);
    expect(slashed).to.include.members(expected);
    expect(h.peers.map((peer) => peer.address)).to.include.members(slashed);
}
