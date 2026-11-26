# ThresholdShortcutChainSlashes.t.sol

Test file: [test/V1/StateChannelDiamondProxy/ThresholdShortcutChainSlashes.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/ThresholdShortcutChainSlashes.t.sol)
Exercises: [DisputeManagerFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md)

## Overview

A harness over the upload and reduce facets seats the disputer, Bob and Carol, and records chain
slashes through the production writer. Slashing Bob and Carol leaves the disputer as the whole
threshold set, so the disputer's own signature confirms each uploaded dispute. A dispute that lists
both slashes finalizes at upload: its claimed output is the reduced result and both periods are
back-dated by the evidence time. A dispute that lists only Bob opens a normal window at the upload
time with no reduced result, and `reduce` over it at window end lists Bob and Carol. An unlisted
slash of an outsider who was never seated does not stop the shortcut. A pending joiner seeded at
the inbound head, slashed and not listed, keeps the dispute in a normal window.

## Tests

- `test_uploadDispute_listingEveryChainSlashedMember_finalizesAtUpload`: REQ-DIS-13-SNWKMF.T1.P1, UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P26
- `test_uploadDispute_omittingOneChainSlashedMember_takesTheNormalWindowAndReduceFoldsTheSlash`: REQ-DIS-13-SNWKMF.T1.P2, UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P27
- `test_uploadDispute_chainSlashedNonMemberUnlisted_stillFinalizesAtUpload`: REQ-DIS-13-SNWKMF.T1.P3, UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P28
- `test_uploadDispute_omittingAChainSlashedPendingJoiner_takesTheNormalWindow`: REQ-DIS-13-SNWKMF.T1.P4, UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P29
