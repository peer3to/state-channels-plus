# AgreementManager.test.ts

Test file: [test/unit/AgreementManager.test.ts](../../../../../../test/unit/AgreementManager.test.ts)

## Overview

The suite drives AgreementManager through harness queries and its public methods on live channels.
It checks latest signer evidence, everyone-signed predicates, milestone-only `buildStateProof`,
final and latest snapshot selection, and reduction inputs. Built proofs are checked by the chain
verifier. The genesis case keeps an unfinalized block-zero run in one milestone and checks the
replay index and genesis final snapshot. Other cases cover membership changes, missing signatures,
unknown forks, concurrent construction, and inbound recovery for reduction. Skipped declarations
record inputs unavailable through the public surface; they are not passing evidence.

## Tests

- `malformed participant address`: none
- `corrupt signature on a stored block`: none
- `a participant signing every block → their latest block, signature recovers to them`: none
- `a participant who stopped signing → returns their last signed block, not the latest block`: none
- `a participant that never signed this fork → null`: none
- `attacker-supplied unknown forkId walks empty → null, not a throw`: none
- `a fully-signed block → true`: none
- `a block missing a participant's signature → false`: none
- `out-of-range blockHeight from a sync request`: none
- `fully-signed latest block → milestones-only proof, verifyMilestones passes`: none
- `U22 (genesis): latest block missing a signature → one unfinalized genesis-linked milestone, the chain walk accepts it`: REQ-SP-8-9ZCCEJ.T6.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P58
- `unknown fork → buildStateProof throws 'Fork not found', the verification projection → null`: none
- `proof requested below the on-chain anchor (a leave the exits' snapshot covers) → buildStateProof throws, no proof from history below the anchor`: none
- `proof requested below a participant join → tops out at the requested height`: none
- `proof requested at the on-chain anchor height → the anchor block alone, reports that height, verifies`: none
- `proof requested at the exact join-block height, raised threshold completed only above it → tops out at the requested height`: none
- `proofs sampled while 10 blocks are produced → each verifies on-chain at its sampled height`: none
- `empty milestone throws`: none
- `multi-milestone proof → snapshot per milestone tracks its first block; finalized + latest select the LAST`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P1
- `no milestone (empty proof) → genesis`: none
- `unfinalized genesis-linked milestone (no provable finality) → stays genesis`: none
- `empty proof → genesis`: none
- `milestone carrier → the latest block's snapshot, not genesis`: none
- `unfinalized genesis-linked milestone → still the latest block's snapshot`: none
- `empty milestone → undefined`: none
- `empty proof → null`: none
- `[a] -> [a,b] -> [c] -> [d] → milestone [1..3] final at block 1, block 0 excluded`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P2
- `hostile reducedOutput / dispute commitment`: none
- `getForkDisputes / getForkDisputeConfirmations on a fork with no dispute window → empty, not a throw`: none
- `unrecoverable reduce run → undefined, not a throw`: none
- `recoverable reduce run → the full applied run`: none
- `reduce-to-genesis → getReduceData resolves the genesis snapshot`: none
