# DecodeOutOfGasVerdict.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DecodeOutOfGasVerdict.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DecodeOutOfGasVerdict.t.sol)
Exercises: [StateChannelCommon.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md)

## Overview

Each case commits A's dispute with one heavy block (50 message blocks of 10 empty messages, about
2.35M gas to decode), measures B's challenge at 30M gas and asserts the full-gas verdict (killed for
a true challenge, kept for the false one), then sweeps 150 gas limits below that cost. Every probe
that does not revert must reach the full-gas verdict, and B is slashed exactly when that verdict
rejects the challenge. Each true sweep has at least one probe that reverts with
`ErrorBlockDecodeOutOfGas`. The swept readers are the pointer step's predecessor decode, the pointer
step's checked run start (a heavy first block), the eligibility read of a heavy first block, the header
scan of a heavy last block naming another fork, the conflict check of a heavy block at the final
height, and the authenticity check of a heavy predecessor in an applied invalid-timestamp proof. An
out-of-gas decode read as "undecodable" would answer "no fault" in each and slash B. The false pointer
challenge at a heavy honest block checks that an under-funded call never kills. The other decode
readers share the one owner, `_tryDecodeBlock`, whose guard is covered by the owner test
`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P17`.

## Tests

- `test_underfundedTrueChallengeAtABlockAfterAHeavyPredecessorIsNoVerdict`: REQ-SP-7-70EMAT.T5.P10, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P79
- `test_underfundedTrueChallengeAtABlockAfterAHeavyFirstBlockIsNoVerdict`: REQ-SP-7-70EMAT.T5.P21
- `test_underfundedFalseChallengeAtAHeavyHonestBlockIsNoVerdict`: REQ-SP-7-70EMAT.T5.P11
- `test_underfundedTrueBlockStructureChallengeAfterAHeavyFirstBlockIsNoVerdict`: REQ-SP-7-70EMAT.T5.P12
- `test_underfundedTrueHeaderChallengeAtAHeavyLastBlockIsNoVerdict`: REQ-SP-7-70EMAT.T5.P18
- `test_underfundedTrueConflictChallengeAtAHeavyBlockIsNoVerdict`: REQ-SP-7-70EMAT.T5.P19
- `test_underfundedTrueTimestampProofAfterAHeavyPredecessorIsNoVerdict`: REQ-SP-7-70EMAT.T5.P20
