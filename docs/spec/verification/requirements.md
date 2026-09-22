# Requirement test status

> Written by `yarn spec:ids:fix` from the Covers cells under `tests/`; never edit. A merge conflict here is resolved by rerunning it.

[`INV-AUTH-1-J0PRYA` (Signature is the only proof)](../specification/peer-communication/handshake.md#inv-auth-1-j0prya)
Specification cases tested: 1/4. Untested: T1.P2, T1.P3, T1.P4.

[`INV-AUTH-2-VQ6D54` (Domain separation)](../specification/peer-communication/handshake.md#inv-auth-2-vq6d54)
Specification cases tested: 1/5. Untested: T1.P2, T1.P3, T1.P4, T1.P5.

[`INV-AUTH-3-0QP5E9` (Objective facts only)](../specification/peer-communication/handshake.md#inv-auth-3-0qp5e9)
Specification cases tested: 0/2.

[`INV-BCP-2-BVPQF4` (Failed validation restores the VM)](../implementation/views/architecture/sdk/block-confirmation-pipeline.md#inv-bcp-2-bvpqf4)
Specification cases tested: 1/1.

[`INV-BCP-6-1E943Z` (A fraud proof is stored before every live dispute)](../implementation/views/architecture/sdk/block-confirmation-pipeline.md#inv-bcp-6-1e943z)
Specification cases tested: 2/2.

[`INV-BLKSTORE-1-MK4W8D` (Index consistency)](../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)
Specification cases tested: 4/4.

[`INV-BLOCK-PIPE-1-1AB2ME` (Atomic ordered commit)](../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me)
Specification cases tested: 3/11. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8.

[`INV-CONFIG-1-0FJ2HX` (Deterministic effective configuration)](../specification/runtime/configuration.md#inv-config-1-0fj2hx)
Specification cases tested: 0/8.

[`INV-CONTRACT-ARCH-1-TWQHTM` (Single logical state)](../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm)
Specification cases tested: 0/12.

[`INV-DA-1-TS7HX2` (A posted block-calldata commitment MUST be immutable for its key and binding)](../specification/security/data-availability.md#inv-da-1-ts7hx2)
Specification cases tested: 0/8.

[`INV-DATA-1-F8CG0P` (Equal logical values have one canonical encoding and decode identically in…)](../specification/protocol-model/data-types.md#inv-data-1-f8cg0p)
Specification cases tested: 0/21.

[`INV-DIS-5-J1QZ92` (The reduced result is independent of the order in which valid dispute inputs…)](../specification/disputes/disputes.md#inv-dis-5-j1qz92)
Specification cases tested: 0/21.

[`INV-DIS-7-9GGZSD` (In a fork whose reduction contains any on-chain slashes, timeout removal is not…)](../specification/disputes/disputes.md#inv-dis-7-9ggzsd)
Specification cases tested: 0/17.

[`INV-DIS-8-1GY6Q5` (A fork applies at most one timeout, targeting the participant at the lowest…)](../specification/disputes/disputes.md#inv-dis-8-1gy6q5)
Specification cases tested: 0/19.

[`INV-DISPUTE-PIPE-1-BN0K81` (Equivalent audit)](../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81)
Specification cases tested: 0/6.

[`INV-DVP-2-Q13TVQ` (Kill decisions use canonical predicates)](../implementation/views/architecture/sdk/dispute-pipeline.md#inv-dvp-2-q13tvq)
Specification cases tested: 1/1.

[`INV-DVP-3-ZMF1HA` (Invalid audit stores exactly one fraud proof)](../implementation/views/architecture/sdk/dispute-pipeline.md#inv-dvp-3-zmf1ha)
Specification cases tested: 1/1.

[`INV-DVP-5-NAJRB0` (Every dispute path installs a successor fork)](../implementation/views/architecture/sdk/dispute-pipeline.md#inv-dvp-5-najrb0)
Specification cases tested: 1/1.

[`INV-DVP-6-RFSBRQ` (Fraud-proof enforcement is separate from reduction)](../implementation/views/architecture/sdk/dispute-pipeline.md#inv-dvp-6-rfsbrq)
Specification cases tested: 1/1.

[`INV-ENFADM-1-H53AQY` (Inbound append is the only membership/value entry)](../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy)
Specification cases tested: 5/5.

[`INV-ENFDIS-1-1K65DT` (Commitment-exact reduction)](../specification/enforcement/dispute-window.md#inv-enfdis-1-1k65dt)
Specification cases tested: 0/7.

[`INV-ENFFP-1-BGVZN4` (Slash set integrity)](../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4)
Specification cases tested: 1/11. Untested: T1.P1, T1.P2, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11.

[`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)
Specification cases tested: 0/8.

[`INV-ENFSM-1-762ACD` (Replay from supplied state only)](../specification/enforcement/execution-and-consumer.md#inv-enfsm-1-762acd)
Specification cases tested: 0/3.

[`INV-ENFSNAP-1-9VZ2HE` (Single monotone snapshot)](../specification/enforcement/snapshot-adoption.md#inv-enfsnap-1-9vz2he)
Specification cases tested: 1/6. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6.

[`INV-FIN-2-MK27J6` (Signing a block is a binding, non-equivocating vote for that block and the)](../specification/protocol-model/finality.md#inv-fin-2-mk27j6)
Specification cases tested: 2/13. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13.

[`INV-FIN-8-G6V1M1` (Valid transitions that lacked finality when a dispute began are not reverted)](../specification/protocol-model/finality.md#inv-fin-8-g6v1m1)
Specification cases tested: 0/8.

[`INV-FP-8-BFNRSY` (Proof application is idempotent per offender)](../specification/disputes/fraud-proofs.md#inv-fp-8-bfnrsy)
Specification cases tested: 0/17.

[`INV-HIST-1-5N44K9` (Block commits to the state snapshot hash)](../specification/protocol-model/history-and-commitments.md#inv-hist-1-5n44k9)
Specification cases tested: 0/8.

[`INV-HIST-2-27M8VA` (Hash-linking)](../specification/protocol-model/history-and-commitments.md#inv-hist-2-27m8va)
Specification cases tested: 0/8.

[`INV-HIST-3-T17T78` (Snapshots commit to inbound and outbound message-stream tips)](../specification/protocol-model/history-and-commitments.md#inv-hist-3-t17t78)
Specification cases tested: 0/8.

[`INV-HIST-4-DSMGGT` (forkId = keccak256)](../specification/protocol-model/history-and-commitments.md#inv-hist-4-dsmggt)
Specification cases tested: 0/8.

[`INV-HSK-1-R44CN1` (Address bound only after mutual verification)](../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-1-r44cn1)
Specification cases tested: 1/1.

[`INV-HSK-5-3E60DY` (One agreementTime skew window)](../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-5-3e60dy)
Specification cases tested: 4/4.

[`INV-ID-1-B4FXJ4` (Key control is identity)](../specification/protocol-model/identity.md#inv-id-1-b4fxj4)
Specification cases tested: 0/7.

[`INV-IFD-1-HBJR2P` (One recorded acknowledgment per peer and fork)](../implementation/views/architecture/sdk/rpc/is-fork-disputed.md#inv-ifd-1-hbjr2p)
Specification cases tested: 1/1.

[`INV-IFD-3-DZ83BB` (One outgoing round per fork)](../implementation/views/architecture/sdk/rpc/is-fork-disputed.md#inv-ifd-3-dz83bb)
Specification cases tested: 1/1.

[`INV-JOINSIG-1-JX5EC4` (Identity triple-binding)](../specification/peer-communication/join-authorization.md#inv-joinsig-1-jx5ec4)
Specification cases tested: 4/4.

[`INV-LIF-5-ENQB91` (Settlement conserves value)](../specification/settlement/lifecycle.md#inv-lif-5-enqb91)
Specification cases tested: 1/7. Untested: T1.P1, T1.P2, T1.P4, T1.P5, T1.P6, T1.P7.

[`INV-LOBBY-1-TW7RZT` (Exclusive match ownership)](../specification/peer-communication/lobby-matching.md#inv-lobby-1-tw7rzt)
Specification cases tested: 4/4.

[`INV-LOG-1-P4WT6R` (A collection reaches connected roots)](../specification/runtime/log-collection.md#inv-log-1-p4wt6r)
Specification cases tested: 4/6. Untested: T1.P5, T1.P6.

[`INV-LOG-2-C7KZ9M` (Collections never wait on one another)](../specification/runtime/log-collection.md#inv-log-2-c7kz9m)
Specification cases tested: 11/14. Untested: T1.P2, T1.P3, T1.P4.

[`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)
Specification cases tested: 6/6.

[`INV-MIRROR-1-VAF778` (Single implementation)](../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
Specification cases tested: 0/6.

[`INV-MSG-1-36Y41Q` (Each stream is one hash-linked chain per channel)](../specification/settlement/cross-layer-messages.md#inv-msg-1-36y41q)
Specification cases tested: 0/14.

[`INV-MSG-2-PQ0T1K` (No replay, no omission)](../specification/settlement/cross-layer-messages.md#inv-msg-2-pq0t1k)
Specification cases tested: 0/7.

[`INV-MSG-3-PCR3KT` (Tip totalBalance = cumulative sum of message balances)](../specification/settlement/cross-layer-messages.md#inv-msg-3-pcr3kt)
Specification cases tested: 1/7. Untested: T1.P1, T1.P2, T1.P4, T1.P5, T1.P6, T1.P7.

[`INV-MSG-4-6E5G7V` (totalWithdrawals ≤ totalDeposits at every outbound processing step)](../specification/settlement/cross-layer-messages.md#inv-msg-4-6e5g7v)
Specification cases tested: 2/7. Untested: T1.P2, T1.P4, T1.P5, T1.P6, T1.P7.

[`INV-MSG-5-YC48R5` (Processed tips advance only to strictly newer descendants)](../specification/settlement/cross-layer-messages.md#inv-msg-5-yc48r5)
Specification cases tested: 0/8.

[`INV-MSG-6-1C22RD` (Balance invariant)](../specification/settlement/cross-layer-messages.md#inv-msg-6-1c22rd)
Specification cases tested: 1/7. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7.

[`INV-NEG-1-6FW90P` (Negotiated-terms-only signing)](../specification/peer-communication/channel-negotiation.md#inv-neg-1-6fw90p)
Specification cases tested: 0/8.

[`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
Specification cases tested: 3/6. Untested: T1.P2, T1.P4, T1.P5.

[`INV-RUN-3-1AKG2E` (Host construction failure closes the port)](../implementation/views/architecture/sdk/runtime-and-concurrency.md#inv-run-3-1akg2e)
Specification cases tested: 1/1.

[`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../specification/runtime/execution.md#inv-runtime-1-akrhak)
Specification cases tested: 6/9. Untested: T1.P2, T1.P4, T1.P5.

[`INV-SDK-ARCH-1-KNAX7F` (Coherent participant state)](../specification/runtime/sdk.md#inv-sdk-arch-1-knax7f)
Specification cases tested: 0/4.

[`INV-SM-1-J7BP6D` (Transitions deterministic)](../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
Specification cases tested: 0/11.

[`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
Specification cases tested: 0/7.

[`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)
Specification cases tested: 3/4. Untested: T1.P2.

[`INV-SP-6-GNW74H` (Extending the proved anchor with unfinalized blocks is safe because signing is a)](../specification/disputes/state-proofs.md#inv-sp-6-gnw74h)
Specification cases tested: 0/19.

[`INV-SPC-1-ZV8QM5` (Payload validated against own chain reads)](../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-1-zv8qm5)
Specification cases tested: 4/4.

[`INV-SPC-3-EP3TPG` (One in-flight sync per peer)](../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-3-ep3tpg)
Specification cases tested: 1/1.

[`INV-SPC-4-WVXS19` (Fail-closed spectating)](../implementation/views/architecture/sdk/rpc/spectate.md#inv-spc-4-wvxs19)
Specification cases tested: 5/5.

[`INV-SYNC-1-XCQZ28` (Nothing trusted on receipt)](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28)
Specification cases tested: 1/6. Untested: T1.P1, T1.P3, T1.P4, T1.P5, T1.P6.

[`INV-SYNC-2-AT3RXE` (Requester-anchored validation)](../specification/peer-communication/synchronization.md#inv-sync-2-at3rxe)
Specification cases tested: 1/2. Untested: T1.P2.

[`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed)
Specification cases tested: 6/28. Untested: T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P15, T1.P16, T1.P17, T1.P18, T1.P19, T1.P20, T1.P21, T1.P22, T1.P23, T1.P24, T1.P25, T1.P26, T1.P27, T1.P28.

[`INV-SYNC-4-Z6HER7` (Read-only trust establishment)](../specification/peer-communication/synchronization.md#inv-sync-4-z6her7)
Specification cases tested: 0/5.

[`INV-TJOIN-1-R3K75D` (Exact target ownership)](../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d)
Specification cases tested: 3/3.

[`INV-TJOIN-2-H7JSQM` (Local pending protection for submitted joins)](../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm)
Specification cases tested: 5/5.

[`INV-TRUST-1-6TYWDH` (Every safety-relevant disagreement MUST be resolvable by the chain from…)](../specification/security/trust-model.md#inv-trust-1-6tywdh)
Specification cases tested: 0/6.

[`INV-UPG-1-KW2A02` (Best-effort with no protocol effect)](../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02)
Specification cases tested: 0/3.

[`REQ-AUTH-1-RF901K` (Validate before signing)](../specification/peer-communication/handshake.md#req-auth-1-rf901k)
Specification cases tested: 0/5.

[`REQ-AUTH-2-BQ5CRG` (Fresh single-use challenges)](../specification/peer-communication/handshake.md#req-auth-2-bq5crg)
Specification cases tested: 0/3.

[`REQ-AUTH-3-ZV74KB` (Completion requires both roles)](../specification/peer-communication/handshake.md#req-auth-3-zv74kb)
Specification cases tested: 1/5. Untested: T1.P1, T1.P3, T1.P4, T1.P5.

[`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../specification/peer-communication/handshake.md#req-auth-4-jwcf71)
Specification cases tested: 4/6. Untested: T1.P1, T1.P3.

[`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag)
Specification cases tested: 10/11. Untested: T1.P11.

[`REQ-AUTH-6-E7SSH3` (Initiator verification and bidirectional clock compatibility)](../specification/peer-communication/handshake.md#req-auth-6-e7ssh3)
Specification cases tested: 0/9.

[`REQ-AUTH-7-VJFSD5` (Uniform continued interaction)](../specification/peer-communication/handshake.md#req-auth-7-vjfsd5)
Specification cases tested: 0/5.

[`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
Specification cases tested: 0/9.

[`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b)
Specification cases tested: 0/14.

[`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
Specification cases tested: 0/6.

[`REQ-BCP-1-X3J4KY` (Both input paths converge on one ingest)](../implementation/views/architecture/sdk/block-confirmation-pipeline.md#req-bcp-1-x3j4ky)
Specification cases tested: 1/1.

[`REQ-BCP-2-1K3HN9` (Canonical predicate for the timestamp rule)](../implementation/views/architecture/sdk/block-confirmation-pipeline.md#req-bcp-2-1k3hn9)
Specification cases tested: 0/3.

[`REQ-BCP-4-MS5VVZ` (Total-order state application)](../implementation/views/architecture/sdk/block-confirmation-pipeline.md#req-bcp-4-ms5vvz)
Specification cases tested: 1/1.

[`REQ-BLKSTORE-1-KYHTWT` (Same-coordinate conflict is not resolved here)](../specification/storage/blocks.md#req-blkstore-1-kyhtwt)
Specification cases tested: 3/3.

[`REQ-BLKSTORE-2-VWXP2C` (Monotone signature merge)](../specification/storage/blocks.md#req-blkstore-2-vwxp2c)
Specification cases tested: 1/3. Untested: T1.P2, T1.P3.

[`REQ-BLKSTORE-3-S9V2KC` (Tip tracking and bounded traversal)](../specification/storage/blocks.md#req-blkstore-3-s9v2kc)
Specification cases tested: 2/3. Untested: T1.P2.

[`REQ-BLOCK-PIPE-1-SS24D1` (Unified work item)](../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1)
Specification cases tested: 2/5. Untested: T1.P1, T1.P3, T1.P4.

[`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
Specification cases tested: 1/10. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9.

[`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
Specification cases tested: 12/16. Untested: T1.P2, T1.P3, T1.P8, T1.P9.

[`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)
Specification cases tested: 6/9. Untested: T1.P2, T1.P4, T1.P5.

[`REQ-BLOCK-PIPE-5-WJ31RG` (Pre-execution merge layer)](../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg)
Specification cases tested: 0/9.

[`REQ-BLOCK-PIPE-6-XQ0RTT` (Total-order application)](../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt)
Specification cases tested: 1/6. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6.

[`REQ-BLOCK-PIPE-7-FYE9VJ` (Commit before publish)](../specification/block-progression/block-processing.md#req-block-pipe-7-fye9vj)
Specification cases tested: 0/3.

[`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)
Specification cases tested: 9/9.

[`REQ-BLOCK-PIPE-9-QA66GT` (Dead-fork containment)](../specification/block-progression/block-processing.md#req-block-pipe-9-qa66gt)
Specification cases tested: 1/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P6.

[`REQ-BLOCK-PIPE-10-PHAKE2` (Counter-signing policy)](../specification/block-progression/block-processing.md#req-block-pipe-10-phake2)
Specification cases tested: 1/5. Untested: T1.P1, T1.P2, T1.P4, T1.P5.

[`REQ-BLOCK-PIPE-11-DCHAJ2` (Signature admission by participant union)](../specification/block-progression/block-processing.md#req-block-pipe-11-dchaj2)
Specification cases tested: 4/7. Untested: T1.P1, T1.P5, T1.P6.

[`REQ-CDSTORE-1-ECWBNY` (Coordinate-keyed calldata with exact matching)](../specification/storage/calldata-and-timeouts.md#req-cdstore-1-ecwbny)
Specification cases tested: 2/5. Untested: T1.P1, T1.P4, T1.P5.

[`REQ-CFG-1-W7C6C6` (Configuration precedence)](../implementation/views/operations/configuration.md#req-cfg-1-w7c6c6)
Specification cases tested: 3/5. Untested: T1.P1, T1.P5.

[`REQ-CFG-2-FCY3ZR` (Environment values coerced by field type)](../implementation/views/operations/configuration.md#req-cfg-2-fcy3zr)
Specification cases tested: 2/20. Untested: T1.P1, T1.P2, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16, T1.P17, T1.P19, T1.P20.

[`REQ-CFG-3-9NKNSV` (Environment configuration is Node-only)](../implementation/views/operations/configuration.md#req-cfg-3-9nknsv)
Specification cases tested: 1/5. Untested: T1.P2, T1.P3, T1.P4, T1.P5.

[`REQ-CFG-4-8CHK0C` (One resolved configuration per process)](../implementation/views/operations/configuration.md#req-cfg-4-8chk0c)
Specification cases tested: 0/4.

[`REQ-CFG-5-98V1M0` (No secrets in checked-in defaults)](../implementation/views/operations/configuration.md#req-cfg-5-98v1m0)
Specification cases tested: 0/4.

[`REQ-CON-1-ER48S7` (Deployable bytecode within the EIP-170 budget)](../implementation/views/architecture/contracts/architecture.md#req-con-1-er48s7)
Specification cases tested: 1/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5.

[`REQ-CON-2-CBVFV9` (Build fails on a size-budget violation)](../implementation/views/architecture/contracts/architecture.md#req-con-2-cbvfv9)
Specification cases tested: 8/8.

[`REQ-CONFIG-1-PDHA8T` (Explicit precedence)](../specification/runtime/configuration.md#req-config-1-pdha8t)
Specification cases tested: 0/6.

[`REQ-CONFIG-2-JA2SKN` (Cross-layer compatibility)](../specification/runtime/configuration.md#req-config-2-ja2skn)
Specification cases tested: 0/9.

[`REQ-CONFIG-3-J4H12F` (Safe bounds)](../specification/runtime/configuration.md#req-config-3-j4h12f)
Specification cases tested: 0/7.

[`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
Specification cases tested: 1/7. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6.

[`REQ-CONTRACT-ARCH-2-BE651C` (Shared validation)](../specification/enforcement/contracts.md#req-contract-arch-2-be651c)
Specification cases tested: 0/5.

[`REQ-CONTRACT-ARCH-3-GEGD78` (Internal-call confinement)](../specification/enforcement/contracts.md#req-contract-arch-3-gegd78)
Specification cases tested: 0/3.

[`REQ-CONTRACT-ARCH-4-FZ3CJE` (Upgrade and deployment integrity)](../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje)
Specification cases tested: 2/7. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P6.

[`REQ-CONTRACT-ARCH-5-QT17P1` (Complete operation ownership)](../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1)
Specification cases tested: 0/4.

[`REQ-CONTRACT-SIZE-1-881Q6E` (Deployment size enforcement)](../specification/enforcement/contracts.md#req-contract-size-1-881q6e)
Specification cases tested: 10/10.

[`REQ-DA-1-NVV85Z` (Block data referenced by any dispute-relevant commitment MUST be obtainable…)](../specification/security/data-availability.md#req-da-1-nvv85z)
Specification cases tested: 1/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5.

[`REQ-DA-2-KYZ70M` (The specification of any timing-sensitive rule MUST state which of these…)](../specification/security/data-availability.md#req-da-2-kyz70m)
Specification cases tested: 0/6.

[`REQ-DA-3-G6TJ90` (This griefing exposure is a deliberate version-one limitation and MUST be stated)](../specification/security/data-availability.md#req-da-3-g6tj90)
Specification cases tested: 0/5.

[`REQ-DA-4-1B0MF4` (Any change to the DA design MUST be evaluated against)](../specification/security/data-availability.md#req-da-4-1b0mf4)
Specification cases tested: 0/5.

[`REQ-DACK-1-ESEGGG` (One round per fork per peer pair)](../specification/peer-communication/dispute-acknowledgment.md#req-dack-1-eseggg)
Specification cases tested: 2/4. Untested: T1.P3, T1.P4.

[`REQ-DACK-2-MJZENJ` (Bilateral records)](../specification/peer-communication/dispute-acknowledgment.md#req-dack-2-mjzenj)
Specification cases tested: 0/3.

[`REQ-DACK-3-J4Z33Y` (Knowledge-gated consequences)](../specification/peer-communication/dispute-acknowledgment.md#req-dack-3-j4z33y)
Specification cases tested: 2/3. Untested: T1.P3.

[`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../specification/protocol-model/data-types.md#req-data-1-1knrqs)
Specification cases tested: 0/9.

[`REQ-DATA-2-A5HMZP` (Field and collection ordering, duplicate policy, optionality, and nested-byte…)](../specification/protocol-model/data-types.md#req-data-2-a5hmzp)
Specification cases tested: 0/7.

[`REQ-DATA-3-ANVN8X` (Encoded and signed values bind every domain coordinate required by their owning…)](../specification/protocol-model/data-types.md#req-data-3-anvn8x)
Specification cases tested: 0/9.

[`REQ-DATA-4-HFEAEA` (Integers and bytes cross ABI, off-chain runtime, worker, RPC, and persistence…)](../specification/protocol-model/data-types.md#req-data-4-hfeaea)
Specification cases tested: 0/9.

[`REQ-DIS-1-XAJ1VA` (A dispute MUST state at least one of the five valid inputs)](../specification/disputes/disputes.md#req-dis-1-xaj1va)
Specification cases tested: 4/15. Untested: T1.P2, T1.P4, T1.P6, T1.P7, T1.P8, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15.

[`REQ-DIS-2-PKVZ7E` (Upload is limited to eligible disputers)](../specification/disputes/disputes.md#req-dis-2-pkvz7e)
Specification cases tested: 8/23. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16.

[`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../specification/disputes/disputes.md#req-dis-3-c4kysf)
Specification cases tested: 2/21. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P17, T1.P18, T1.P19, T1.P20, T1.P21.

[`REQ-DIS-4-6J6YYG` (Reduction runs only after the kill period expires and consumes exactly the…)](../specification/disputes/disputes.md#req-dis-4-6j6yyg)
Specification cases tested: 1/16. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15.

[`REQ-DIS-6-Y92H1M` (Every initiated dispute window MUST end in a canonical successor fork, genesis…)](../specification/disputes/disputes.md#req-dis-6-y92h1m)
Specification cases tested: 4/16. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14.

[`REQ-DIS-9-64WHCD` (The on-chain snapshot advances to a successor fork only along committed…)](../specification/disputes/disputes.md#req-dis-9-64whcd)
Specification cases tested: 1/22. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16, T1.P17, T1.P18, T1.P19, T1.P20, T1.P21, T1.P22.

[`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../specification/disputes/disputes.md#req-dis-10-sahjbn)
Specification cases tested: 2/16. Untested: T1.P2, T1.P3, T1.P4, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16.

[`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)
Specification cases tested: 3/8. Untested: T1.P1, T1.P2, T1.P3, T1.P7, T1.P8.

[`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1)
Specification cases tested: 0/8.

[`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
Specification cases tested: 14/24. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10.

[`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
Specification cases tested: 5/12. Untested: T1.P1, T1.P3, T1.P4, T1.P6, T1.P7, T1.P8, T1.P9.

[`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)
Specification cases tested: 19/22. Untested: T1.P3, T1.P4, T1.P9.

[`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
Specification cases tested: 2/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4.

[`REQ-DISPUTE-PIPE-7-76N72X` (Combined membership intent)](../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x)
Specification cases tested: 3/3.

[`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
Specification cases tested: 10/10.

[`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
Specification cases tested: 41/41.

[`REQ-DISPUTE-PIPE-10-BT8YAR` (Recheck an early timeout submission)](../specification/disputes/dispute-processing.md#req-dispute-pipe-10-bt8yar)
Specification cases tested: 8/8.

[`REQ-DSTORE-1-5AQYJX` (Dispute confirmation merge)](../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx)
Specification cases tested: 1/3. Untested: T1.P2, T1.P3.

[`REQ-DSTORE-2-H1DAGX` (Own-dispute guard)](../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx)
Specification cases tested: 0/5.

[`REQ-DSTORE-3-ZNXSTM` (Content-addressed proofs with stable indexes)](../specification/storage/dispute-evidence.md#req-dstore-3-znxstm)
Specification cases tested: 6/6.

[`REQ-DVP-1-MQJTYR` (Timeout submission respects race guards)](../implementation/views/architecture/sdk/dispute-pipeline.md#req-dvp-1-mqjtyr)
Specification cases tested: 2/2.

[`REQ-ENFADM-1-V926CA` (Self-submission with pinned state)](../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca)
Specification cases tested: 7/7.

[`REQ-ENFADM-2-K6K9SP` (Membership-split correctness)](../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp)
Specification cases tested: 6/6.

[`REQ-ENFADM-3-6A3BEB` (Custody through the adapter only)](../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb)
Specification cases tested: 4/4.

[`REQ-ENFDIS-1-8CSA6B` (Window bookkeeping integrity)](../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b)
Specification cases tested: 3/9. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6, T1.P7.

[`REQ-ENFDIS-2-VV9FPR` (Bounded participation)](../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr)
Specification cases tested: 2/5. Untested: T1.P2, T1.P3, T1.P5.

[`REQ-ENFFP-1-BREACW` (Symmetric stake on submission)](../specification/enforcement/fraud-slashing.md#req-enffp-1-breacw)
Specification cases tested: 2/4. Untested: T1.P2, T1.P4.

[`REQ-ENFFP-2-JXMYNB` (Proof-type completeness at the boundary)](../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb)
Specification cases tested: 2/10. Untested: T1.P1, T1.P2, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10.

[`REQ-ENFPROOF-1-RH4WEM` (Single verification authority)](../specification/enforcement/proof-verification.md#req-enfproof-1-rh4wem)
Specification cases tested: 0/5.

[`REQ-ENFPROOF-2-YZDCXM` (Deduplicated threshold counting)](../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm)
Specification cases tested: 2/5. Untested: T1.P2, T1.P3, T1.P4.

[`REQ-ENFPROOF-3-EEDR2Y` (Falsifying detail on failure)](../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y)
Specification cases tested: 0/5.

[`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
Specification cases tested: 0/4.

[`REQ-ENFSM-2-G4HBKG` (Adapter confinement)](../specification/enforcement/execution-and-consumer.md#req-enfsm-2-g4hbkg)
Specification cases tested: 0/4.

[`REQ-ENFSNAP-1-FYN3BW` (Coupled adoption and outbound processing)](../specification/enforcement/snapshot-adoption.md#req-enfsnap-1-fyn3bw)
Specification cases tested: 1/6. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6.

[`REQ-ENFSNAP-2-MGRCY8` (Batch-split invariance)](../specification/enforcement/snapshot-adoption.md#req-enfsnap-2-mgrcy8)
Specification cases tested: 0/3.

[`REQ-ENFSNAP-3-VD9T8A` (Inbound-consumption gate)](../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a)
Specification cases tested: 3/3.

[`REQ-FIN-1-SP669G` (Participants MUST NOT be required to wait for explicit threshold finality before)](../specification/protocol-model/finality.md#req-fin-1-sp669g)
Specification cases tested: 0/8.

[`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the)](../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
Specification cases tested: 0/14.

[`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored)](../specification/protocol-model/finality.md#req-fin-4-zfdds6)
Specification cases tested: 0/8.

[`REQ-FIN-5-DH29VZ` (Block authoring is deterministic)](../specification/protocol-model/finality.md#req-fin-5-dh29vz)
Specification cases tested: 1/12. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12.

[`REQ-FIN-6-YZWJX2` (Recommended leader-election policy is round-robin as a function of channel state)](../specification/protocol-model/finality.md#req-fin-6-yzwjx2)
Specification cases tested: 2/8. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P8.

[`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
Specification cases tested: 0/17.

[`REQ-FP-1-9PD823` (Fraud-proof enforcement is separate from the dispute game)](../specification/disputes/fraud-proofs.md#req-fp-1-9pd823)
Specification cases tested: 0/11.

[`REQ-FP-2-CH4DA1` (Every block fraud-proof handler is sound)](../specification/disputes/fraud-proofs.md#req-fp-2-ch4da1)
Specification cases tested: 0/22.

[`REQ-FP-3-2AJAZ7` (Slashes are recorded only via addOnChainSlashedParticipant)](../specification/disputes/fraud-proofs.md#req-fp-3-2ajaz7)
Specification cases tested: 0/21.

[`REQ-FP-4-WHKBXP` (A recorded slash disqualifies the participant from dispute participation and…)](../specification/disputes/fraud-proofs.md#req-fp-4-whkbxp)
Specification cases tested: 0/17.

[`REQ-FP-5-ZXW0J5` (A dispute may list any subset of recorded slashes)](../specification/disputes/fraud-proofs.md#req-fp-5-zxw0j5)
Specification cases tested: 0/15.

[`REQ-FP-6-TS1QAV` (An invalid fraud-proof submission slashes its submitter when the submitter is…)](../specification/disputes/fraud-proofs.md#req-fp-6-ts1qav)
Specification cases tested: 0/11.

[`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)
Specification cases tested: 0/21.

[`REQ-FP-9-QG4PW5` (The fraud-proof taxonomy MUST NOT be treated as complete)](../specification/disputes/fraud-proofs.md#req-fp-9-qg4pw5)
Specification cases tested: 0/9.

[`REQ-GOSSIP-1-HTK3NX` (Thin attributed ingress)](../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)
Specification cases tested: 0/3.

[`REQ-GOSSIP-2-9PMMNH` (Verdict-mapped consequences)](../specification/peer-communication/block-gossip.md#req-gossip-2-9pmmnh)
Specification cases tested: 0/7.

[`REQ-GOSSIP-3-HQZNQX` (Re-broadcast on growth)](../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx)
Specification cases tested: 7/10. Untested: T1.P1, T1.P2, T1.P3.

[`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
Specification cases tested: 26/26.

[`REQ-HSK-1-Y9JQS3` (Unguarded endpoints tolerate adversarial input)](../implementation/views/architecture/sdk/rpc/handshake.md#req-hsk-1-y9jqs3)
Specification cases tested: 3/3.

[`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../specification/protocol-model/identity.md#req-id-1-3q2kb9)
Specification cases tested: 0/9.

[`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../specification/protocol-model/identity.md#req-id-2-f3y8j4)
Specification cases tested: 0/7.

[`REQ-ID-3-KR0BE3` (Confined signing authority)](../specification/protocol-model/identity.md#req-id-3-kr0be3)
Specification cases tested: 1/5. Untested: T1.P1, T1.P2, T1.P3, T1.P5.

[`REQ-ID-4-BNEKCM` (Domain-separated signing forms)](../specification/protocol-model/identity.md#req-id-4-bnekcm)
Specification cases tested: 0/7.

[`REQ-IFD-4-26FWYZ` (Acknowledgments gate dead-fork punishment)](../implementation/views/architecture/sdk/rpc/is-fork-disputed.md#req-ifd-4-26fwyz)
Specification cases tested: 1/1.

[`REQ-IX-1-WTJ0D1` (Peer block ingress)](../specification/interactions.md#req-ix-1-wtj0d1)
Specification cases tested: 0/6.

[`REQ-IX-2-2PY2EF` (Deterministic execution and commitment)](../specification/interactions.md#req-ix-2-2py2ef)
Specification cases tested: 0/3.

[`REQ-IX-3-H8WCVY` (Inbound inclusion and join flow)](../specification/interactions.md#req-ix-3-h8wcvy)
Specification cases tested: 0/6.

[`REQ-IX-4-BB35GC`](../specification/disputes/README.md#req-ix-4-bb35gc)
Specification cases tested: 0/4.

[`REQ-IX-5-6XHJJB` (On-chain adjudication)](../specification/interactions.md#req-ix-5-6xhjjb)
Specification cases tested: 0/5.

[`REQ-IX-6-A4Y7KB` (Snapshot adoption and outbound processing)](../specification/interactions.md#req-ix-6-a4y7kb)
Specification cases tested: 0/6.

[`REQ-IX-7-A004VZ` (Chain observation)](../specification/interactions.md#req-ix-7-a004vz)
Specification cases tested: 0/4.

[`REQ-IX-8-FY54AV` (Execution equivalence)](../specification/interactions.md#req-ix-8-fy54av)
Specification cases tested: 0/4.

[`REQ-IX-9-AV56NR` (Storage fidelity)](../specification/interactions.md#req-ix-9-av56nr)
Specification cases tested: 0/6.

[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
Specification cases tested: 4/4.

[`REQ-JOINSIG-2-RR2G4Q` (All-or-nothing unanimity)](../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)
Specification cases tested: 8/8.

[`REQ-JOINSIG-3-VAGFVD` (Refusal is penalty-free)](../specification/peer-communication/join-authorization.md#req-joinsig-3-vagfvd)
Specification cases tested: 7/7.

[`REQ-LIF-1-A5BN02` (The best-case complete lifecycle needs at least two base-layer transactions)](../specification/settlement/lifecycle.md#req-lif-1-a5bn02)
Specification cases tested: 2/13. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13.

[`REQ-LIF-2-Z3Z9Y3` (Exactly two paths lead to a state that can update the on-chain snapshot and…)](../specification/settlement/lifecycle.md#req-lif-2-z3z9y3)
Specification cases tested: 1/16. Untested: T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16.

[`REQ-LIF-3-PDRTPY` (A normal state transition MAY produce an outbound message)](../specification/settlement/lifecycle.md#req-lif-3-pdrtpy)
Specification cases tested: 0/8.

[`REQ-LIF-4-SW8GVY` (Every initiated dispute runs through the dispute game and produces a canonical)](../specification/settlement/lifecycle.md#req-lif-4-sw8gvy)
Specification cases tested: 0/12.

[`REQ-LIF-6-VG861M` (Four protocol windows are configured on the manager at deployment)](../specification/settlement/lifecycle.md#req-lif-6-vg861m)
Specification cases tested: 0/6.

[`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed)](../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
Specification cases tested: 0/6.

[`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)
Specification cases tested: 9/9.

[`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
Specification cases tested: 11/11.

[`REQ-LOBBY-1-PZTPKD` (Caller-owned rendezvous)](../specification/peer-communication/lobby-matching.md#req-lobby-1-pztpkd)
Specification cases tested: 4/4.

[`REQ-LOBBY-2-TSWRV6` (Authenticated admission)](../specification/peer-communication/lobby-matching.md#req-lobby-2-tswrv6)
Specification cases tested: 6/6.

[`REQ-LOBBY-3-Q9WY40` (Convergent roles)](../specification/peer-communication/lobby-matching.md#req-lobby-3-q9wy40)
Specification cases tested: 5/5.

[`REQ-LOBBY-4-E0TARV` (Atomic selection)](../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv)
Specification cases tested: 4/4.

[`REQ-LOBBY-5-VTRX8C` (Mutual commitment)](../specification/peer-communication/lobby-matching.md#req-lobby-5-vtrx8c)
Specification cases tested: 4/4.

[`REQ-LOBBY-6-QSZEXP` (Lease-safe role timing)](../specification/peer-communication/lobby-matching.md#req-lobby-6-qszexp)
Specification cases tested: 5/5.

[`REQ-LOBBY-7-BXQ1QA` (Symmetric timeout consequence)](../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa)
Specification cases tested: 8/8.

[`REQ-LOBBY-8-31BE0F` (Profile-loss recovery)](../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f)
Specification cases tested: 6/6.

[`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
Specification cases tested: 22/23. Untested: T1.P12.

[`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../specification/runtime/log-collection.md#req-log-1-h2vq8x)
Specification cases tested: 6/10. Untested: T1.P1, T1.P2, T1.P3, T1.P4.

[`REQ-LOG-2-N6BJ3D` (The caller receives its local upload outcome)](../specification/runtime/log-collection.md#req-log-2-n6bj3d)
Specification cases tested: 4/5. Untested: T1.P3.

[`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../specification/runtime/log-collection.md#req-log-3-t9fm2k)
Specification cases tested: 2/4. Untested: T1.P3, T1.P4.

[`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../specification/runtime/log-collection.md#req-log-4-w5xr7q)
Specification cases tested: 4/6. Untested: T1.P4, T1.P5.

[`REQ-LOG-5-ST6S0G` (Sending twice does not store twice)](../specification/runtime/log-collection.md#req-log-5-st6s0g)
Specification cases tested: 3/4. Untested: T1.P1.

[`REQ-LOG-6-Q8KY4N` (One run's logs never overwrite another's)](../specification/runtime/log-collection.md#req-log-6-q8ky4n)
Specification cases tested: 3/4. Untested: T1.P1.

[`REQ-LOG-7-M2RC5W` (Nothing unpacks without a limit)](../specification/runtime/log-collection.md#req-log-7-m2rc5w)
Specification cases tested: 7/7.

[`REQ-LOG-8-B7VN3J` (Works wherever the runtime works)](../specification/runtime/log-collection.md#req-log-8-b7vn3j)
Specification cases tested: 4/6. Untested: T1.P2, T1.P6.

[`REQ-LOG-9-V6SMAC` (An application report records its reason)](../specification/runtime/log-collection.md#req-log-9-v6smac)
Specification cases tested: 0/4.

[`REQ-LOG-10-69CTN1` (A thread that is ending waits only for its own)](../specification/runtime/log-collection.md#req-log-10-69ctn1)
Specification cases tested: 0/3.

[`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
Specification cases tested: 2/10. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8.

[`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
Specification cases tested: 2/4. Untested: T1.P2, T1.P3.

[`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
Specification cases tested: 2/4. Untested: T1.P1, T1.P4.

[`REQ-MSG-1-AY3A77` (Snapshots MUST commit both stream tips + totals)](../specification/settlement/cross-layer-messages.md#req-msg-1-ay3a77)
Specification cases tested: 0/12.

[`REQ-MSG-2-7YAD1A` (A dispute's claimed inbound tip MUST be an ancestor of the chain tip with…)](../specification/settlement/cross-layer-messages.md#req-msg-2-7yad1a)
Specification cases tested: 0/12.

[`REQ-MSG-3-YY569F` (Packaged inbound blocks MUST chain from the previous snapshot tip and exist…)](../specification/settlement/cross-layer-messages.md#req-msg-3-yy569f)
Specification cases tested: 0/12.

[`REQ-MSG-4-SC1FEX` (Outbound processing MUST verify the linked range and skip the processed prefix…)](../specification/settlement/cross-layer-messages.md#req-msg-4-sc1fex)
Specification cases tested: 0/8.

[`REQ-MSG-5-5XB7DB` (Catch-up MUST be batchable into smaller ranges with identical results)](../specification/settlement/cross-layer-messages.md#req-msg-5-5xb7db)
Specification cases tested: 0/6.

[`REQ-MSG-6-MZNQAM` (Snapshot advance MUST require finality or finalized reduction + expired…)](../specification/settlement/cross-layer-messages.md#req-msg-6-mznqam)
Specification cases tested: 0/12.

[`REQ-MSG-7-Q40Q3R` (Same-fork advance MUST consume all pending inbound messages)](../specification/settlement/cross-layer-messages.md#req-msg-7-q40q3r)
Specification cases tested: 0/8.

[`REQ-MSG-8-N1ECJ5` (Exits MUST be withdrawable only through snapshot advance)](../specification/settlement/cross-layer-messages.md#req-msg-8-n1ecj5)
Specification cases tested: 0/13.

[`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)
Specification cases tested: 4/6. Untested: T1.P5, T1.P6.

[`REQ-MSG-10-7JS45Q` (Joining MUST carry the joiner's signature plus the full threshold set's…)](../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q)
Specification cases tested: 0/19.

[`REQ-MSG-11-VS3ZGC` (A deposited-but-unincluded joiner MUST be able to force inclusion via the…)](../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc)
Specification cases tested: 4/20. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14, T1.P15, T1.P16.

[`REQ-MSG-12-1RRB0W` (Anyone MUST be able to verify the balance invariant trustlessly for a claimed…)](../specification/settlement/cross-layer-messages.md#req-msg-12-1rrb0w)
Specification cases tested: 0/13.

[`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)
Specification cases tested: 0/7.

[`REQ-MSGSTORE-2-8RDXPZ` (Linked backward range reads)](../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz)
Specification cases tested: 8/9. Untested: T1.P6.

[`REQ-NEG-1-RTKPT1` (Deterministic proposer and submitter)](../specification/peer-communication/channel-negotiation.md#req-neg-1-rtkpt1)
Specification cases tested: 2/6. Untested: T1.P1, T1.P2, T1.P3, T1.P5.

[`REQ-NEG-2-ED48TZ` (Chain-observed completion)](../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz)
Specification cases tested: 3/7. Untested: T1.P1, T1.P2, T1.P3, T1.P4.

[`REQ-NEG-4-ZQ0985` (Committed-attempt admission and recovery)](../specification/peer-communication/channel-negotiation.md#req-neg-4-zq0985)
Specification cases tested: 15/17. Untested: T1.P2, T1.P6.

[`REQ-PSCSTORE-1-7BDTEV` (Complete ordered change points)](../specification/storage/participant-changes.md#req-pscstore-1-7bdtev)
Specification cases tested: 7/7.

[`REQ-QSTORE-1-PS769J`](../specification/peer-communication/block-gossip.md#req-qstore-1-ps769j)
Specification cases tested: 6/6.

[`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../specification/storage/queue.md#req-qstore-2-vywjaq)
Specification cases tested: 24/24.

[`REQ-QSTORE-3-DEKYG6` (Queue scheduling)](../specification/storage/queue.md#req-qstore-3-dekyg6)
Specification cases tested: 5/5.

[`REQ-RMSTORE-1-BWKVBG` (Monotone observation progress)](../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg)
Specification cases tested: 2/3. Untested: T1.P1.

[`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)
Specification cases tested: 0/4.

[`REQ-RPC-1-FF89Z0` (Typed wire contract)](../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
Specification cases tested: 9/10. Untested: T1.P6.

[`REQ-RPC-2-SZDTTM` (Request lifecycle)](../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
Specification cases tested: 14/20. Untested: T1.P8, T1.P9, T1.P11, T1.P14, T1.P16, T1.P18.

[`REQ-RPC-3-ZM9WR5` (Service authorization)](../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5)
Specification cases tested: 1/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P6.

[`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)
Specification cases tested: 7/8. Untested: T1.P4.

[`REQ-RPC-5-CV1R1Y` (Resource bounds)](../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)
Specification cases tested: 3/11. Untested: T1.P3, T1.P4, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11.

[`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
Specification cases tested: 11/11.

[`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
Specification cases tested: 12/12.

[`REQ-RPC-8-44XECF` (Compatibility before protected calls)](../specification/peer-communication/rpc.md#req-rpc-8-44xecf)
Specification cases tested: 0/3.

[`REQ-RUN-1-FSV0SH` (Serialized messages over paired ports)](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-1-fsv0sh)
Specification cases tested: 1/1.

[`REQ-RUN-6-MTBT2H` (Structured-clone limits on boundary values)](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h)
Specification cases tested: 4/4.

[`REQ-RUN-8-A4B4SA` (Harness control is a custom-RPC root)](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-8-a4b4sa)
Specification cases tested: 1/1.

[`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../specification/runtime/execution.md#req-runtime-1-rsm6mz)
Specification cases tested: 0/7.

[`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../specification/runtime/execution.md#req-runtime-2-kbxktg)
Specification cases tested: 1/5. Untested: T1.P2, T1.P3, T1.P4, T1.P5.

[`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59)
Specification cases tested: 61/65. Untested: T1.P2, T1.P3, T1.P4, T1.P6.

[`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../specification/runtime/execution.md#req-runtime-4-b0n70y)
Specification cases tested: 2/6. Untested: T1.P1, T1.P2, T1.P3, T1.P4.

[`REQ-RUNTIME-5-WJ1XKK` (Required host environments: browser and Node)](../specification/runtime/execution.md#req-runtime-5-wj1xkk)
Specification cases tested: 0/17.

[`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../specification/runtime/execution.md#req-runtime-6-6f4ssm)
Specification cases tested: 2/2.

[`REQ-SDK-1-JKC9W7` (The runtime owns its signer)](../implementation/views/architecture/sdk/architecture.md#req-sdk-1-jkc9w7)
Specification cases tested: 1/1.

[`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
Specification cases tested: 0/6.

[`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8)
Specification cases tested: 0/5.

[`REQ-SDK-ARCH-3-WHTDWX` (Event fidelity)](../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx)
Specification cases tested: 0/5.

[`REQ-SDK-ARCH-4-GTN7QN` (Execution isolation)](../specification/runtime/sdk.md#req-sdk-arch-4-gtn7qn)
Specification cases tested: 0/4.

[`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
Specification cases tested: 0/21.

[`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
Specification cases tested: 0/9.

[`REQ-SM-3-88RFP2` (Mappings only with complete deterministic key enumeration)](../specification/protocol-model/state-machines.md#req-sm-3-88rfp2)
Specification cases tested: 0/10.

[`REQ-SM-4-Z32M0W` (Ordering/encoding/round-trip defined explicitly)](../specification/protocol-model/state-machines.md#req-sm-4-z32m0w)
Specification cases tested: 0/8.

[`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
Specification cases tested: 0/12.

[`REQ-SM-6-BJZVQ5` (Turn authorization enforced generically at the protocol layer)](../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5)
Specification cases tested: 0/8.

[`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
Specification cases tested: 0/11.

[`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
Specification cases tested: 3/12. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6, T1.P7, T1.P8, T1.P12, T1.P14.

[`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
Specification cases tested: 0/17.

[`REQ-SM-10-JD8TSF` (Slashing or removal of a participant absent from the state being transformed…)](../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf)
Specification cases tested: 7/7.

[`REQ-SM-11-VVP01C` (Application-defined participant insertion)](../specification/protocol-model/state-machines.md#req-sm-11-vvp01c)
Specification cases tested: 18/18.

[`REQ-SNAPSTORE-1-AJW0HJ` (Genesis index consistency)](../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj)
Specification cases tested: 1/3. Untested: T1.P2, T1.P3.

[`REQ-SNAPSTORE-2-Q7E6TQ` (Derived reads fail explicitly)](../specification/storage/snapshots-and-states.md#req-snapstore-2-q7e6tq)
Specification cases tested: 4/6. Untested: T1.P4, T1.P5.

[`REQ-SP-1-9YABY1` (A milestone is not merely a list of independently threshold-signed blocks)](../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
Specification cases tested: 1/8. Untested: T1.P1, T1.P2, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8.

[`REQ-SP-2-ST4JJ4` (A state proof establishes a path from one final anchor to the next, and finally…)](../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
Specification cases tested: 0/8.

[`REQ-SP-3-SP1JG4` (A join or removal changes the threshold set, so a proof crossing a membership…)](../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
Specification cases tested: 0/13.

[`REQ-SP-4-NCSEX4` (When a proof starts at fork genesis, genesis is the implicit final anchor for)](../specification/disputes/state-proofs.md#req-sp-4-ncsex4)
Specification cases tested: 1/14. Untested: T1.P1, T1.P2, T1.P3, T1.P5, T1.P6, T1.P7, T1.P8, T1.P9, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14.

[`REQ-SP-5-MTE4RV` (The final block of the proved path supplies the state commitment)](../specification/disputes/state-proofs.md#req-sp-5-mte4rv)
Specification cases tested: 0/12.

[`REQ-SP-7-70EMAT` (Linkage checks)](../specification/disputes/state-proofs.md#req-sp-7-70emat)
Specification cases tested: 2/14. Untested: T1.P1, T1.P2, T1.P3, T1.P4, T1.P5, T1.P6, T1.P7, T1.P8, T1.P11, T1.P12, T1.P13, T1.P14.

[`REQ-SPC-1-H10R5K` (Prove at least the requested height)](../implementation/views/architecture/sdk/rpc/spectate.md#req-spc-1-h10r5k)
Specification cases tested: 5/5.

[`REQ-STOR-1-D4XE73` (Complete durable set)](../specification/storage/durability.md#req-stor-1-d4xe73)
Specification cases tested: 0/4.

[`REQ-STOR-2-TARP8S` (Commit-aligned durability)](../specification/storage/durability.md#req-stor-2-tarp8s)
Specification cases tested: 0/19.

[`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../specification/storage/durability.md#req-stor-3-4rjger)
Specification cases tested: 0/4.

[`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](../specification/storage/durability.md#req-stor-4-mf6ft6)
Specification cases tested: 0/5.

[`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../specification/storage/durability.md#req-stor-5-t6eqsa)
Specification cases tested: 0/6.

[`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../specification/storage/durability.md#req-stor-6-skp0km)
Specification cases tested: 0/6.

[`REQ-SYNC-1-T2589H` (Minimum-target proving)](../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
Specification cases tested: 12/16. Untested: T1.P2, T1.P4, T1.P7, T1.P16.

[`REQ-SYNC-2-TNT4F4` (Economic soundness before adoption)](../specification/peer-communication/synchronization.md#req-sync-2-tnt4f4)
Specification cases tested: 1/3. Untested: T1.P1, T1.P3.

[`REQ-SYNC-3-1P5ZHT` (Suffix through the standard pipeline)](../specification/peer-communication/synchronization.md#req-sync-3-1p5zht)
Specification cases tested: 0/3.

[`REQ-TIME-1-FM4651` (Chain time is authoritative)](../specification/protocol-model/time.md#req-time-1-fm4651)
Specification cases tested: 0/12.

[`REQ-TIME-2-VG94S7` (Honest participants keep estimated chain time within the skew bound)](../specification/protocol-model/time.md#req-time-2-vg94s7)
Specification cases tested: 0/12.

[`REQ-TIME-3-MT1MMF` (Window values and skew bound are explicit configuration trade-offs)](../specification/protocol-model/time.md#req-time-3-mt1mmf)
Specification cases tested: 4/14. Untested: T1.P3, T1.P4, T1.P5, T1.P6, T1.P8, T1.P10, T1.P11, T1.P12, T1.P13, T1.P14.

[`REQ-TIME-4-83V27Z` (Timeouts/fraud proofs/slashing use only objectively validated timestamps)](../specification/protocol-model/time.md#req-time-4-83v27z)
Specification cases tested: 0/15.

[`REQ-TIME-5-S9NQXK` (Every local contract execution observes the runtime's current estimated chain…)](../specification/protocol-model/time.md#req-time-5-s9nqxk)
Specification cases tested: 3/3.

[`REQ-TJOIN-1-5VGR1F` (Independent public options)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)
Specification cases tested: 6/6.

[`REQ-TJOIN-2-MFWADG` (Separated matching and handoff)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg)
Specification cases tested: 7/7.

[`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
Specification cases tested: 8/8.

[`REQ-TJOIN-4-SDPZJW` (Direct response routing)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-4-sdpzjw)
Specification cases tested: 3/4. Untested: T1.P2.

[`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
Specification cases tested: 6/6.

[`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh)
Specification cases tested: 5/5.

[`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
Specification cases tested: 11/11.

[`REQ-TOSTORE-1-JQPXBC` (Lowest-height timeout candidate)](../specification/storage/calldata-and-timeouts.md#req-tostore-1-jqpxbc)
Specification cases tested: 0/5.

[`REQ-TRUST-1-K5PS99` (Version one uses only objective, deterministic, mathematically verifiable)](../specification/security/trust-model.md#req-trust-1-k5ps99)
Specification cases tested: 0/7.

[`REQ-TRUST-2-X8GCZ7` (A client MUST have at least one available, honest RPC connection through which…)](../specification/security/trust-model.md#req-trust-2-x8gcz7)
Specification cases tested: 0/7.

[`REQ-TRUST-3-3YWEZR` (The protocol assumes at least one non-Byzantine participant in each)](../specification/security/trust-model.md#req-trust-3-3ywezr)
Specification cases tested: 0/12.

[`REQ-TRUST-4-KW24NF` (Version one REQUIRES a watchtower or equivalent continuously available delegate)](../specification/security/trust-model.md#req-trust-4-kw24nf)
Specification cases tested: 0/19.

[`REQ-TRUST-5-NDVRW8` (The design targets many SMALL channels, not large ones)](../specification/security/trust-model.md#req-trust-5-ndvrw8)
Specification cases tested: 0/6.

[`REQ-TRUST-6-Z586T0` (Temporary assumption A9)](../specification/security/trust-model.md#req-trust-6-z586t0)
Specification cases tested: 0/8.

[`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)
Specification cases tested: 0/4.

[`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)
Specification cases tested: 2/5. Untested: T1.P2, T1.P3, T1.P4.

[`REQ-UPG-3-T1SRMS` (Single deterministic initiator)](../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms)
Specification cases tested: 0/6.

[`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)
Specification cases tested: 12/12.

[`REQ-UPG-5-YQV7MJ` (Relay retries converge without stale work)](../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj)
Specification cases tested: 8/8.

[`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)
Specification cases tested: 6/6.
