// @spec-test-coverage-ignore: state-proof construction staging exercised by explicit AgreementManager, DisputeManager and SnapshotUpdateService declarations
import { StateSnapshot } from "@/models";
import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { buildAndEncodeBlock, hash as randomHash } from "@test/factory";
import { craftProofBlock } from "@test/fixtures/DisputeAuditStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import type { BaseContract } from "ethers";

/**
 * The proof `peerIndex` builds at `blockHeight` (default its tip): its shape,
 * the chain's walk of it (chainValid, replayBlockIndex) and the builder's own
 * walk (finalizedSnapshotHash). A build failure throws its message.
 */
export async function constructProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    blockHeight?: number
) {
    const result = await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const { agreementManager: am, forkId, storage } = sm;
            const genesis =
                storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
            const height =
                args.blockHeight ??
                storage.blocks.getNextBlockHeight(forkId) - 1;
            try {
                const built = await am.buildStateProof(forkId, height);
                const proof = built.stateProof;
                const snapshots = built.milestoneSnapshots.map((s) => s!);
                const chain =
                    await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                        {
                            channelId: sm.channelId,
                            forkId,
                            stateProof: proof,
                            genesisStateSnapshotData: genesis.snapshotData,
                            milestoneSnapshots: snapshots.map((s) =>
                                s.toStruct()
                            )
                        }
                    );
                return {
                    requestedHeight: height,
                    genesisSnapshotHash: genesis.hash,
                    startHeight: built.startSnapshot.blockHeight,
                    latestProofHeight:
                        am.getLatestBlockFromStateProof(proof)?.height ?? null,
                    latestSnapshotHash: am.getLatestSnapshotFromStateProof(
                        proof,
                        forkId
                    ).hash,
                    milestoneSnapshotHashes: snapshots.map((s) => s.hash),
                    // the heights of each milestone's blocks
                    milestones: proof.milestones.map((m) =>
                        m.blockConfirmations.map(
                            (c) =>
                                am.getLastBlockFromMilestone({
                                    blockConfirmations: [c]
                                })!.height
                        )
                    ),
                    chainValid: chain.valid,
                    replayBlockIndex: chain.valid
                        ? Number(chain.replayBlockIndex)
                        : null,
                    finalizedSnapshotHash: built.finalizedSnapshot?.hash ?? null
                };
            } catch (error) {
                return String(error);
            }
        },
        { blockHeight }
    );
    if (typeof result === "string") throw new Error(result);
    return result;
}

/** A stored block as an encoded confirmation, to delete and restore it. */
export type StoredBlock = { height: number; encodedConfirmation: string };

/** Remove the peer's blocks at `heights` (returned for repair); `strip` stores them back author-signed only. */
export async function deleteStoredBlocks(
    h: MathPeerTestHarness,
    peerIndex: number,
    heights: number[],
    strip = false
): Promise<StoredBlock[]> {
    const confirmations = await h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) =>
            args.heights.map((height) => {
                const block = sm.storage.blocks.getBlock(sm.forkId, height)!;
                sm.storage.blocks.deleteBlock(sm.forkId, height);
                if (args.strip)
                    sm.storage.blocks.storeBlock(block.authorSignedCopy());
                return block.blockConfirmationStruct;
            }),
        { heights, strip }
    );
    return confirmations.map((c, i) => ({
        height: heights[i],
        encodedConfirmation: Codec.encode(c, Type.BlockConfirmation) as string
    }));
}

export async function restoreStoredBlocks(
    h: MathPeerTestHarness,
    peerIndex: number,
    blocks: StoredBlock[]
): Promise<void> {
    const transition = h.control(h.getPeer(peerIndex)).transition;
    for (const b of blocks)
        await transition.storeBlock(b.encodedConfirmation).request();
}

export async function chainSnapshot(h: MathPeerTestHarness) {
    return StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
}

/** The resulting snapshot hash of the peer's stored block at `height`. */
export async function committedSnapshotHash(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
): Promise<string> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) =>
            String(
                sm.storage.blocks.getBlock(sm.forkId, args.height)!
                    .stateSnapshotHash
            ),
        { height }
    );
}

/** Post the peer's same-fork snapshot (seen by every honest mirror) at `expectedHeight`. */
export async function postSnapshotAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    expectedHeight: number
): Promise<StateSnapshot> {
    const forkId = String(h.activeForkId!);
    await h.transition.postSnapshotWait({ peerIndex, forkId });
    const onChain = await chainSnapshot(h);
    expect(onChain.blockHeight).to.equal(expectedHeight);
    return onChain;
}

/** `postStateSnapshotWait` on the peer. */
export async function postSameForkSnapshot(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<boolean> {
    return h.execOnHost(h.getPeer(peerIndex), (sm) =>
        sm.snapshotUpdateService.postStateSnapshotWait(sm.forkId)
    );
}

/** The block count per milestone of the peer's prepared same-fork post. */
export async function prepareSameForkPost(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<number[]> {
    const [call] = (
        await h
            .control(h.getPeer(peerIndex))
            .transition.prepareUpdateSnapshotSameFork(h.activeForkId!)
            .request()
    ).callData;
    const milestones: { blockConfirmations: unknown[] }[] = call
        ? h.channelManager.interface.decodeFunctionData(
              "updateStateSnapshotSameFork",
              call
          )[1]
        : [];
    return milestones.map((m) => m.blockConfirmations.length);
}

/** Four peers; block 2 is a fully signed leave, two more blocks follow, the exit stays unposted. */
export async function stageLeftChannel(h: MathPeerTestHarness) {
    await h.lifecycle.start(4, 2, {
        timeConfig: { agreementTime: 60, chainFallbackTime: 60 }
    });
    const leaverIndex = await h.transition.participantLeaveStateTransition();
    const remaining = [0, 1, 2, 3].filter((index) => index !== leaverIndex);
    // every remaining signature has landed, so a later strip is not undone by a late merge
    await h.transition.advanceState({
        count: 2,
        waitForPeers: remaining,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: remaining });
    expect((await chainSnapshot(h)).isGenesis, "exit unposted").to.equal(true);
    return { remaining, changeHeight: 2 };
}

/** The last of `peerCount` peers is cut off: none of `blockCount` blocks reaches the threshold. */
export async function stageUnsignedGenesisTip(
    h: MathPeerTestHarness,
    peerCount: number,
    blockCount: number
) {
    await h.lifecycle.start(peerCount, 0, {
        timeConfig: { chainFallbackTime: 60 }
    });
    await h.network.blacklistAndDisconnectPeer(peerCount - 1);
    const waitForPeers = [...Array(peerCount - 1).keys()];
    await h.transition.advanceState({ count: blockCount, waitForPeers });
}

/** `stageLeftChannel`, then an inbound join no block consumes. */
export async function stageExitAndPendingJoin(h: MathPeerTestHarness) {
    const { remaining } = await stageLeftChannel(h);
    await h.join.forceInboundJoinWait({ observePeerIndices: remaining });
    return { remaining };
}

/**
 * `stageLeftChannel`, then a same-fork snapshot post above the exit and one
 * more block: the proof starts at the posted snapshot, whose outbound tip is
 * the exit block.
 */
export async function stageSameForkStartAboveExit(h: MathPeerTestHarness) {
    const { remaining, changeHeight } = await stageLeftChannel(h);
    const forkId = String(h.activeForkId!);
    await h.transition.postSnapshotWait({ peerIndex: remaining[0], forkId });
    const start = await chainSnapshot(h);
    expect(start.forkID).to.equal(forkId);
    expect(start.blockHeight).to.be.greaterThan(changeHeight);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: remaining,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: remaining });
    return { remaining, start };
}

/**
 * One `constructDispute` on the peer: the error, the stored head height,
 * whether the dispute carries the peer's head proof, and the chain
 * `verifyStateProof` and `findFirstInvalidBlockStructureInStateProof` reads
 * made during it (record-only; every read still runs).
 */
export async function constructRecordingChainProofReads(
    h: MathPeerTestHarness,
    peerIndex: number
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm) => {
            const { agreementManager: am, storage, forkId } = sm;
            const chain =
                sm.stateChannelManagerContract as unknown as BaseContract;
            const chainReads: string[] = [];
            const restoreChain: (() => void)[] = [];
            for (const name of [
                "verifyStateProof",
                "findFirstInvalidBlockStructureInStateProof"
            ]) {
                const previous = Object.getOwnPropertyDescriptor(chain, name);
                const original = chain.getFunction(name);
                const method = (...call: unknown[]) => {
                    chainReads.push(name);
                    return original(...call);
                };
                Object.defineProperty(method, "staticCall", {
                    value: (...call: unknown[]) => {
                        chainReads.push(name);
                        return original.staticCall(...call);
                    }
                });
                Object.defineProperty(chain, name, {
                    value: method,
                    configurable: true,
                    writable: true
                });
                restoreChain.push(() => {
                    if (previous) Object.defineProperty(chain, name, previous);
                    else Reflect.deleteProperty(chain, name);
                });
            }
            const latestHeight = storage.blocks.getNextBlockHeight(forkId) - 1;
            // no module imports run host-side: compare the plain structs
            const encode = (proof: StateProofStruct) =>
                JSON.stringify(proof, (_key, item: unknown) =>
                    typeof item === "bigint" ? item.toString() : item
                );
            try {
                const { dispute } =
                    await sm.disputeManager.constructDispute(forkId);
                const head = await am.buildStateProof(forkId, latestHeight);
                return {
                    latestHeight,
                    chainReads,
                    error: null,
                    carriesHeadProof:
                        encode(dispute.input.stateProof) ===
                        encode(head.stateProof)
                };
            } catch (error) {
                return {
                    latestHeight,
                    chainReads,
                    error: String(error),
                    carriesHeadProof: false
                };
            } finally {
                for (const restore of restoreChain) restore();
            }
        },
        {}
    );
}

/**
 * The peer stores another real state's bytes under its head snapshot's state
 * hash (a sync payload keyed by a snapshot hash it does not match), then
 * constructs a dispute. Returns the construction error.
 */
export async function constructOverMismatchedHeadState(
    h: MathPeerTestHarness,
    peerIndex: number
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm) => {
            const { storage, forkId } = sm;
            const head = storage.blocks.getNextBlockHeight(forkId) - 1;
            const headSnapshot = storage.getStateSnapshot({
                forkId,
                height: head
            })!;
            const otherState = storage.stateMachineStates.getStateMachineState(
                storage.getStateSnapshot({ forkId, height: 0 })!
                    .stateMachineStateHash
            )!;
            const headState = storage.stateMachineStates.getStateMachineState(
                headSnapshot.stateMachineStateHash
            )!;
            storage.stateMachineStates.storeStateMachineState(otherState, {
                hash: headSnapshot.stateMachineStateHash
            });
            try {
                await sm.disputeManager.constructDispute(forkId);
                return { statesDiffer: otherState !== headState, error: null };
            } catch (error) {
                return {
                    statesDiffer: otherState !== headState,
                    error: String(error)
                };
            } finally {
                storage.stateMachineStates.storeStateMachineState(headState, {
                    hash: headSnapshot.stateMachineStateHash
                });
            }
        },
        {}
    );
}

/**
 * `getAuditingData` on the peer for a plain `StateProof`: `stateProof` (from
 * another peer), else the peer's own head proof - followed by its proof at
 * the height below when `descending` (milestones out of order: every walk
 * rejects it while each snapshot is held). State bytes are projected as
 * the stored state of a snapshot; a thrown error is returned.
 */
export async function auditPlainProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    options: {
        stateProof?: StateProofStruct;
        descending?: boolean;
    } = {}
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const am = sm.agreementManager;
            const { storage, forkId } = sm;
            // stored state bytes are hex strings
            const stateOf = (snapshot: StateSnapshot | undefined) =>
                snapshot
                    ? ((storage.stateMachineStates.getStateMachineState(
                          snapshot.stateMachineStateHash
                      ) ?? null) as string | null)
                    : null;
            const project = (value: unknown) =>
                JSON.stringify(value, (_key, item: unknown) =>
                    typeof item === "bigint" ? item.toString() : item
                );
            const head = storage.blocks.getNextBlockHeight(forkId) - 1;
            let proof = args.stateProof;
            if (!proof) {
                proof = (await am.buildStateProof(forkId, head)).stateProof;
                if (args.descending)
                    proof = {
                        milestones: [
                            ...proof.milestones,
                            ...(await am.buildStateProof(forkId, head - 1))
                                .stateProof.milestones
                        ]
                    };
            }
            const headState =
                head >= 0
                    ? stateOf(
                          storage.getStateSnapshot({ forkId, height: head })
                      )
                    : null;
            const genesis = project(
                storage.stateSnapshots
                    .getGenesisSnapshotByForkId(forkId)!
                    .toStruct()
            );
            try {
                const { isPartial, auditingData } =
                    await sm.disputeManager.getAuditingData(forkId, proof);
                const held = (await am.describeStateProof(forkId, proof))
                    .milestoneSnapshots;
                return {
                    threw: null,
                    isPartial,
                    finalizedState:
                        auditingData.latestFinalizedStateStateMachineState,
                    headState,
                    latestIsGenesis:
                        project(auditingData.latestStateSnapshot) === genesis,
                    // per milestone: held locally, and whether the genesis
                    // snapshot stands at its index
                    milestones: auditingData.milestoneSnapshots.map(
                        (snapshot, index) => ({
                            held: held[index] !== undefined,
                            isGenesis: project(snapshot) === genesis
                        })
                    )
                };
            } catch (error) {
                return {
                    threw: String(error),
                    isPartial: null,
                    finalizedState: null,
                    headState,
                    latestIsGenesis: null,
                    milestones: []
                };
            }
        },
        {
            stateProof: options.stateProof,
            descending: options.descending ?? false
        }
    );
}

/**
 * The proof `peerIndex` builds at `blockHeight` (default its tip): the proof
 * itself, its block heights per milestone, its milestone snapshot hashes
 * (null where storage lacks one) and the builder walk's finalized snapshot.
 */
export async function buildOwnProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    options: { blockHeight?: number; stopAtThresholdCompletion?: boolean } = {}
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const { agreementManager: am, forkId, storage } = sm;
            const height =
                args.blockHeight ??
                storage.blocks.getNextBlockHeight(forkId) - 1;
            const built = await am.buildStateProof(forkId, height, {
                stopAtThresholdCompletion: args.stopAtThresholdCompletion
            });
            const { milestones } = built.stateProof;
            return {
                stateProof: {
                    milestones: milestones.map((m) => ({
                        blockConfirmations: m.blockConfirmations.map((c) => ({
                            signedBlock: {
                                encodedBlock: String(
                                    c.signedBlock.encodedBlock
                                ),
                                signature: String(c.signedBlock.signature)
                            },
                            signatures: c.signatures.map(String)
                        }))
                    }))
                },
                milestones: milestones.map((m) =>
                    m.blockConfirmations.map(
                        (c) =>
                            am.getLastBlockFromMilestone({
                                blockConfirmations: [c]
                            })!.height
                    )
                ),
                milestoneSnapshotHashes: built.milestoneSnapshots.map((s) =>
                    s ? String(s.hash) : null
                ),
                finalizedSnapshotHash: built.finalizedSnapshot
                    ? String(built.finalizedSnapshot.hash)
                    : null
            };
        },
        {
            blockHeight: options.blockHeight,
            stopAtThresholdCompletion:
                options.stopAtThresholdCompletion ?? false
        }
    );
}

export type StateProofVerificationOutcome = {
    status: "valid" | "invalid" | "threw";
    /** the start the deciding walk ran from; null for the fork genesis */
    startHash: string | null;
    finalizedSnapshotHash: string | null;
    replayBlockIndex: number | null;
    errorName: string | null;
    errorMessage: string | null;
};

/**
 * `verifyStateProof` of `stateProof` on `peerIndex`, with the evidence that
 * peer describes for it (the fork genesis where it holds no snapshot), as a
 * disputer's auditor without posted data does. A thrown error is returned.
 */
export async function verifyOnPeer(
    h: MathPeerTestHarness,
    peerIndex: number,
    stateProof: StateProofStruct
): Promise<StateProofVerificationOutcome> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args): Promise<StateProofVerificationOutcome> => {
            const { agreementManager: am, forkId, storage } = sm;
            const genesis =
                storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
            const described = await am.describeStateProof(
                forkId,
                args.stateProof
            );
            const none = {
                startHash: null,
                finalizedSnapshotHash: null,
                replayBlockIndex: null,
                errorName: null,
                errorMessage: null
            };
            try {
                const verified = await am.verifyStateProof(
                    {
                        channelId: sm.channelId,
                        forkId,
                        stateProof: args.stateProof
                    },
                    {
                        genesisStateSnapshotData: genesis.snapshotData,
                        milestoneSnapshots: described.milestoneSnapshots.map(
                            (s) => (s ?? genesis).toStruct()
                        )
                    }
                );
                if (verified.status === "invalid")
                    return { ...none, status: "invalid" };
                return {
                    ...none,
                    status: "valid",
                    startHash: verified.start
                        ? String(verified.start.hash)
                        : null,
                    finalizedSnapshotHash: String(
                        verified.finalizedSnapshot.hash
                    ),
                    replayBlockIndex: verified.replayBlockIndex
                };
            } catch (error) {
                return {
                    ...none,
                    status: "threw",
                    errorName: error instanceof Error ? error.name : "",
                    errorMessage:
                        error instanceof Error ? error.message : String(error)
                };
            }
        },
        { stateProof }
    );
}

/**
 * `describeStateProof` on `peerIndex` of a proof whose milestones hold the
 * peer's stored blocks (by height) or foreign confirmations.
 */
export async function describeOnPeer(
    h: MathPeerTestHarness,
    peerIndex: number,
    milestones: (number | BlockConfirmationStruct)[][]
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const { agreementManager: am, forkId, storage } = sm;
            const described = await am.describeStateProof(forkId, {
                milestones: args.milestones.map((run) => ({
                    blockConfirmations: run.map((entry) =>
                        typeof entry === "number"
                            ? storage.blocks.getBlock(forkId, entry)!
                                  .blockConfirmationStruct
                            : entry
                    )
                }))
            });
            return {
                startSnapshotHash: String(described.startSnapshot.hash),
                milestoneSnapshotHashes: described.milestoneSnapshots.map(
                    (s) => (s ? String(s.hash) : null)
                )
            };
        },
        { milestones }
    );
}

/** The hash of the peer's genesis snapshot of its fork. */
export async function genesisSnapshotHash(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<Hash> {
    return (await h.execOnHost(h.getPeer(peerIndex), (sm) =>
        String(
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(sm.forkId)!
                .hash
        )
    )) as Hash;
}

/**
 * A block of the active fork at `height` that only `authorIndex` signed,
 * linked to `previousBlockHash` (default: no block) and committing an
 * unknown snapshot.
 */
export async function authorOnlyConfirmation(
    h: MathPeerTestHarness,
    authorIndex: number,
    height: number,
    previousBlockHash?: Hash
) {
    const { signedBlock, block } = await craftProofBlock(h, {
        authorIndex,
        forkId: h.activeForkId!,
        height,
        previousBlockHash
    });
    const confirmation: BlockConfirmationStruct = {
        signedBlock: {
            encodedBlock: String(signedBlock.encodedBlock),
            signature: String(signedBlock.signature)
        },
        signatures: []
    };
    return { confirmation, hash: block.hash };
}

/**
 * A Byzantine author's own run at heights 0..length-1, linked from the fork
 * genesis and signed only by the author: one unfinal genesis run that no
 * honest peer stored.
 */
export async function forgedGenesisRun(
    h: MathPeerTestHarness,
    authorIndex: number,
    length: number
): Promise<StateProofStruct> {
    let previous = await genesisSnapshotHash(h, authorIndex);
    const blockConfirmations: BlockConfirmationStruct[] = [];
    for (let height = 0; height < length; height++) {
        const { confirmation, hash } = await authorOnlyConfirmation(
            h,
            authorIndex,
            height,
            previous
        );
        blockConfirmations.push(confirmation);
        previous = hash;
    }
    return { milestones: [{ blockConfirmations }] };
}

/**
 * Replace the peer's stored block at `height` with a block it authors at that
 * height that links to no block and commits an unknown snapshot.
 */
export async function replaceWithUnlinkedBlock(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: number
): Promise<void> {
    await deleteStoredBlocks(h, peerIndex, [height]);
    await restoreStoredBlocks(h, peerIndex, [
        {
            height,
            encodedConfirmation: await buildAndEncodeBlock(
                h.getPeer(peerIndex).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId: h.activeForkId!,
                        transactionCnt: height
                    },
                    previousBlockHash: randomHash()
                }
            )
        }
    ]);
}
