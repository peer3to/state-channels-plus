import { HarnessBlock } from "./HarnessBlock";
import { Codec, Type, hash } from "@/utils";
import { Context } from "./ContextBlocks";
import { Event } from "./EventBlocks";
import { SignatureUtils } from "@/utils/SignatureUtils";

/**
 * Tamper helper functions
 * Pure functions that modify dispute objects for testing
 */

/**
 * Tampers with the auditing data hash to make it incorrect
 */
function tamperAuditingDataHash(dispute: {
    input: { disputeAuditingDataHash: string };
}): void {
    // Tamper: set incorrect auditing data hash (dummy value)
    dispute.input.disputeAuditingDataHash = hash("0x42");
}

/**
 * Tampers with the timeout participant address
 */
function createTamperTimeoutParticipant(
    wrongParticipantAddress: string,
    blockHeight: number
) {
    return (dispute: {
        input: { timeout: { participant: string; blockHeight: number } };
    }): void => {
        // Tamper: set timeout participant to someone who is NOT next to write
        dispute.input.timeout.participant = wrongParticipantAddress;
        dispute.input.timeout.blockHeight = blockHeight;
    };
}

/**
 * Tampers BOTH the auditing data hash AND the latest state snapshot hash
 * This causes both commitment check and state proof verification to fail
 */
function tamperDoubleFault(dispute: {
    input: { disputeAuditingDataHash: string; latestStateSnapshotHash: string };
}): void {
    // Tamper BOTH: auditing data hash (commitment check fails)
    dispute.input.disputeAuditingDataHash = hash("0x42");
    // AND: latest state snapshot hash (state proof verification fails)
    dispute.input.latestStateSnapshotHash = hash("0x43");
}

/**
 * Tampers the latest state snapshot hash ONLY (commitment stays valid)
 */
function tamperInvalidStateProof(dispute: {
    input: { latestStateSnapshotHash: string };
}): void {
    // Only tamper the state proof (commitment stays valid)
    dispute.input.latestStateSnapshotHash = hash("0x42");
}

/**
 * Tampers with the first milestone's first block to reference an unknown snapshot
 * This makes auditing data reconstruction partial (missing snapshot) and state proof invalid
 */
function tamperPartialAuditing(dispute: { input: { stateProof: any } }): void {
    const tamperedStateProof = dispute.input.stateProof;
    if (
        tamperedStateProof.milestones.length === 0 ||
        tamperedStateProof.milestones[0].blockConfirmations.length === 0
    ) {
        throw new Error("No milestones to tamper");
    }
    const firstBc = tamperedStateProof.milestones[0].blockConfirmations[0];
    const block = Codec.decode(firstBc.signedBlock.encodedBlock, Type.Block);

    // Tamper: Set to unknown snapshot hash (not stored - makes auditing data partial)
    block.stateSnapshotHash = hash("0xDEADBEEF");

    firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);
}

/**
 * Malicious behavior patterns and attack scenarios
 */
export class Byzantine {
    /**
     * Peer submits a double-signed block (two blocks at same height)
     */
    static doubleSignFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitDoubleSignBlock(peerIndex, {
                forkId
            });

            return harness;
        });
    }

    /**
     * Peer submits an invalid state transition
     */
    static invalidTransitionFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitInvalidStateTransitionBlock(
                peerIndex,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Next peer to write submits an invalid state transition (dynamic peer selection)
     */
    static invalidTransitionFromNext() {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            // Dynamically select the next peer who should write
            const maliciousPeer = await harness.stateQuery.getNextPeerToWrite();

            // Store malicious peer index on harness for use by Event/Assert blocks
            (harness.context as any).lastMaliciousPeerIndex =
                maliciousPeer.index;

            // Submit invalid transition (action only, no waiting)
            await harness.byzantineActions.submitInvalidStateTransitionBlock(
                maliciousPeer.index,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Peer submits a forged inbound message block
     */
    static forgedInboundMessageFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitForgedInboundMessageBlock(
                peerIndex,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Next peer to write submits a forged inbound message block (dynamic peer selection)
     */
    static forgedInboundMessageFromNext() {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            // Dynamically select the next peer who should write
            const maliciousPeer = await harness.stateQuery.getNextPeerToWrite();

            // Store malicious peer index on harness for use by Event/Assert blocks
            (harness.context as any).lastMaliciousPeerIndex =
                maliciousPeer.index;

            // Submit forged inbound message block (action only, no waiting)
            await harness.byzantineActions.submitForgedInboundMessageBlock(
                maliciousPeer.index,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Peer posts a tampered dispute with incorrect auditing data hash
     */
    static tamperedDisputeAuditingData(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            tamperAuditingDataHash
        );
    }

    /**
     * Peer posts a tampered timeout dispute with wrong participant
     */
    static tamperedTimeoutDispute(options: {
        submitter: number;
        wrongParticipant: number;
        blockHeight?: number;
    }) {
        const { submitter, wrongParticipant, blockHeight = 2 } = options;

        return new HarnessBlock(async (harness) => {
            const notNextPeer = harness.peers[wrongParticipant];
            if (!notNextPeer) {
                throw new Error(`Peer ${wrongParticipant} not found`);
            }

            const tamperFn = createTamperTimeoutParticipant(
                notNextPeer.address,
                blockHeight
            );

            // Compose with the generic block
            return await Byzantine.postTamperedDisputeWith(
                submitter,
                tamperFn
            ).run(harness);
        });
    }

    /**
     * Peer posts a tampered dispute where auditing data is partial and state proof invalid
     */
    static tamperedDisputePartialAuditing(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            tamperPartialAuditing
        );
    }

    /**
     * Peer posts a tampered dispute with BOTH invalid commitment AND invalid state proof
     */
    static tamperedDisputeDoubleFault(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(peerIndex, tamperDoubleFault);
    }

    /**
     * Peer posts a tampered dispute with invalid state proof ONLY (commitment is valid)
     */
    static tamperedDisputeInvalidStateProof(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            tamperInvalidStateProof
        );
    }

    /**
     * Peer skips their turn (doesn't author when expected)
     */
    static skipTurn(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.byzantineActions.skipTurn(peerIndex);
            return harness;
        });
    }

    /**
     * Peer posts invalid calldata on-chain (junk calldata with invalid signature)
     */
    static postJunkCalldata(
        peerIndex: number,
        options?: { heightOffset?: number }
    ) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const currentBlock =
                harness.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            if (!currentBlock) {
                throw new Error("No current block found");
            }

            const heightOffset = options?.heightOffset ?? 1;
            await harness.byzantineActions.postJunkCalldataOnChain(peerIndex, {
                height: currentBlock.height + heightOffset
            });

            return harness;
        });
    }

    // ========================================
    // TAMPERED DISPUTES - Dispute Validation Testing
    // ========================================

    /**
     * Generic block: Post a tampered dispute with a custom tamper function
     */
    static postTamperedDisputeWith(
        peerIndex: number,
        tamperFn: (dispute: any) => void
    ) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const { dispute } =
                await harness.disputeOrchestrator.postTamperedDispute(
                    peerIndex,
                    tamperFn,
                    forkId
                );

            // Store dispute for later assertions
            harness.context.lastTamperedDispute = dispute;

            return harness;
        });
    }

    // ========================================
    // COMPOSED SCENARIOS - High-level attack patterns
    // ========================================
    // NOTE: These are meta-blocks that compose multiple primitive blocks.
    // They represent complete attack scenarios rather than single Byzantine actions.

    /**
     * META-BLOCK: Trigger invalid state transition from a malicious peer, wait for disputes, and resolve the fork
     *
     * This is a high-level composition block that orchestrates multiple primitive blocks
     * to create a complete fork resolution scenario. It composes:
     * - Context marking (malicious/honest peers)
     * - Fork capture
     * - Byzantine attack (invalid transition)
     * - Event synchronization (dispute commits, fork change)
     * - Context update
     */
    static createAndResolveFork(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
    }) {
        const { maliciousPeerIndex, honestPeerIndices } = options;

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const totalPeers = harness.peers.length;
            const honest =
                honestPeerIndices ||
                Array.from({ length: totalPeers }, (_, i) => i).filter(
                    (i) => i !== maliciousPeerIndex
                );

            // Compose all blocks using HarnessBlock.compose()
            return HarnessBlock.compose(
                Context.markMaliciousPeer({
                    maliciousPeerIndex,
                    honestPeerIndices
                }),
                Event.captureOriginalFork(),
                Event.reset(),
                Byzantine.invalidTransitionFrom(maliciousPeerIndex),
                Event.waitForAllPeers("onDisputeCommitted", honest.length, {
                    timeoutMs: 5000,
                    mode: "atLeast"
                }),
                Event.waitForForkChange({
                    timeoutMs: 10000,
                    honestPeerIndices: honest
                }),
                Context.updateActiveFork()
            ).run(harness);
        });
    }

    /**
     * META-BLOCK: Create and resolve a fork with full settlement control
     *
     * This is a high-level composition block that creates an invalid state transition
     * dispute and waits for fork resolution with configurable timing for dispute commits
     * and fork settlement.
     *
     * Unlike createAndResolveFork(), this provides:
     * - Control over dispute commit timing (disputesCommittedTimeoutMs)
     * - Control over fork settlement timing (forkSettleTimeoutMs)
     * - More lenient dispute commit requirements (some peers may be slow)
     *
     */
    static createAndResolveForkWithSettlement(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
        forkSettleTimeoutMs?: number;
        disputesCommittedTimeoutMs?: number;
    }) {
        const {
            maliciousPeerIndex,
            honestPeerIndices,
            forkSettleTimeoutMs = 10000,
            disputesCommittedTimeoutMs = 5000
        } = options;

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const totalPeers = harness.peers.length;
            const honest =
                honestPeerIndices ||
                Array.from({ length: totalPeers }, (_, i) => i).filter(
                    (i) => i !== maliciousPeerIndex
                );

            // Mark malicious peer context for later blocks
            harness.context.maliciousPeerIndex = maliciousPeerIndex;
            harness.context.honestPeerIndices = honest;

            // Use disputeOrchestrator action to handle the complex workflow
            const result =
                await harness.disputeOrchestrator.createAndResolveInvalidStateTransitionDispute(
                    maliciousPeerIndex,
                    {
                        forkId,
                        honestPeerIndices: honest,
                        forkSettleTimeoutMs,
                        disputesCommittedTimeoutMs,
                        resetEventSpies: true,
                        disputesCommittedMode: "atLeast",
                        assertMaliciousRemoved: false
                    }
                );

            // Update active fork context
            harness.context.originalForkId = forkId;
            harness.activeForkId = result.newForkId;

            return harness;
        });
    }

    /**
     * Setup tampered dispute construction interception for a peer
     */
    static interceptDisputeConstruction(options: {
        peerIndex: number;
        tamperFn: (dispute: any, confirmation: any) => void | Promise<void>;
    }) {
        const { peerIndex, tamperFn } = options;

        return new HarnessBlock(async (harness) => {
            const { dispute: tamperedDisputePromise, restore } =
                harness.disputeOrchestrator.withConstructDisputeTampering(
                    peerIndex,
                    async (res) => {
                        // Apply the tamper function
                        await tamperFn(res.dispute, res.disputeConfirmation);

                        // Re-sign the tampered dispute
                        const peer = harness.peers[peerIndex];
                        const tamperedSig = await SignatureUtils.signDispute(
                            res.dispute,
                            peer.signer
                        );
                        res.disputeConfirmation.signedDispute = {
                            encodedDispute: tamperedSig.encoded,
                            signature: tamperedSig.signature as any
                        };

                        return res;
                    }
                );

            // Store the promise and restore function
            harness.context.tamperedDisputePromise = tamperedDisputePromise;
            harness.context.restoreDisputeConstruction = restore;

            return harness;
        });
    }

    // ========================================
    // NETWORK MANIPULATION - Connectivity & Isolation
    // ========================================

    /**
     * Disconnect a peer from the P2P network
     */
    static disconnect(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.disconnectPeer(peerIndex);
            return harness;
        });
    }

    /**
     * Simulate a peer timeout (disconnect + wait for timeout events)
     */
    static timeout(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.simulatePeerTimeout(peerIndex);
            return harness;
        });
    }

    /**
     * Reconnect all peers (heal all partitions)
     */
    static reconnectAll() {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.connectAllPeers();
            return harness;
        });
    }

    /**
     * Stub a peer's calldata handler to prevent syncing from on-chain calldata
     */
    static stubCalldataHandler(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const eventHandler = peer.stateManager.eventHandler;
            const originalHandler =
                eventHandler.onBlockCalldataPosted.bind(eventHandler);

            // Store original handler for potential restoration
            (harness as any)[`peer${peerIndex}OriginalCalldataHandler`] =
                originalHandler;

            // Stub with no-op
            eventHandler.onBlockCalldataPosted = async () => {
                // No-op: peer won't process calldata
            };

            return harness;
        });
    }

    /**
     * Restore a peer's original calldata handler
     */
    static restoreCalldataHandler(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const originalHandler = (harness as any)[
                `peer${peerIndex}OriginalCalldataHandler`
            ];
            if (!originalHandler) {
                throw new Error(
                    `No original calldata handler found for peer ${peerIndex}`
                );
            }

            peer.stateManager.eventHandler.onBlockCalldataPosted =
                originalHandler;

            return harness;
        });
    }

    /**
     * Stub a peer's broadcast function to prevent broadcasting blocks
     */
    static stubBroadcast(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const remoteRpc = peer.stateManager.p2pManager.remoteRpc;

            // Store original function for potential restoration
            (harness as any)[`peer${peerIndex}OriginalBroadcast`] =
                remoteRpc.stateTransitionService.onBlockConfirmation;

            // Stub with no-op broadcast
            remoteRpc.stateTransitionService.onBlockConfirmation = (
                _blockConfirmation
            ) => {
                peer.logger.info("Suppressed broadcast from peer " + peerIndex);
                return {
                    broadcast: () => {},
                    sendOne: () => {},
                    sendMultiple: () => {}
                } as any;
            };

            return harness;
        });
    }
}
