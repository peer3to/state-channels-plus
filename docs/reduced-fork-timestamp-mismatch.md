# Why some multi-dispute tests fail: a clock timing mismatch (not a protocol bug)

## The short version

When two disputes happen one after another in a test, honest peers sometimes fall out of
sync and the test fails. We traced it to a **clock timing mismatch inside the test
environment** — the simulated blockchain clock gets ahead of the peers' own clocks. It is
**not** a flaw in the protocol, and it does **not** happen on a live network.

## What actually happens, step by step

1. **A dispute is resolved.** The channel "restarts" on a new version of its history (a new
   fork).

2. **That new version is given a start time, dated in the future.** Specifically: the moment
   the dispute's waiting period ended, _plus_ the evidence-time window (e.g. 10 seconds). So
   the new fork's start time is several seconds **ahead of "now."**

3. **Two different clocks are in play:**

    - the **blockchain clock** (the test's Hardhat node), which drives the fork's start time, and
    - each peer's **own local clock**, which it uses to time-stamp the blocks it writes and to
      judge whether other peers' blocks have sensible timestamps.

4. **In the test, the blockchain clock runs ahead of the peers' local clocks.** The test
   advances the blockchain's time in steps to make the dispute waiting-periods pass quickly,
   but a peer's local clock only moves with real wall-clock time. After two disputes this gap
   builds up to several seconds.

5. **The clash.** When a peer checks a block written on the new fork, the block's timestamp is
   anchored to the (future-dated, blockchain-driven) fork — but the checking peer's local clock
   hasn't caught up. The block's timestamp ends up **outside the narrow time window the peer
   computes from its own lagging clock**, so the peer rejects the honest block as having a bad
   timestamp, treats it as misbehaviour, and opens **another dispute** — and the peers diverge.

## The captured proof (real numbers from the failing test)

From the proof log printed by `src/stateManager/ValidationService.ts` (exact values vary per
run — each run stamps a different wall-clock time and the gap lands around 5–7 seconds; one
captured run):

```
this peer's local clock        = 1781753350
the fork's start time          = 1781753355   (5 seconds AHEAD of the local clock)
the rejected block's timestamp = 1781753356   (6 seconds AHEAD of the local clock)
```

The fork's start time and the block are several seconds ahead of the peer that is doing the
checking. Its clock simply hasn't reached the fork's future-dated start time yet, so the
timestamp check fails.

## Why this is a test-only issue

- On a **live network**, every peer shares the same real, continuously-moving time, and the
  blockchain's block timestamps also follow real time. The clocks stay aligned, so block
  timestamps are always sensible and this rejection never happens.
- In **tests**, the harness fast-forwards the blockchain clock to make dispute windows elapse
  quickly, while peers' local clocks move at real-time pace. That deliberate speed-up is what
  lets the blockchain clock get ahead of the local clocks — and two disputes in a row make the
  gap big enough to trip the timestamp check.

A single dispute usually does **not** trigger it: the test naturally pauses long enough
(settling and syncing) for the local clocks to catch up to the one future-dated start time.
Two disputes plus continued activity is what reliably exposes the gap.

## Proof artifacts

- **Minimal failing test:** `test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts`
  — does two disputes, then continues normal activity, and fails.
- **Companion passing test:** `test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts`
  — two reductions _without_ the follow-on activity passes, showing the reductions themselves
  are sound.
- **Proof log:** running the minimal test prints a line beginning **`TIMING-MISMATCH`** from
  `src/stateManager/ValidationService.ts` with the three numbers above and how many seconds
  ahead of the local clock the fork start / block are.

## How to fix it (test side — no protocol/contract change needed)

Either of:

1. **Let the local clocks catch up.** After a dispute resolves, advance the simulated clock
   (and each peer's local clock) past the new fork's future-dated start time before producing
   any more blocks on it.
2. **Keep the clocks in step while fast-forwarding.** Make the harness advance the blockchain
   clock and the peers' local clocks together (in lockstep) when it fast-forwards time, so the
   blockchain clock never gets ahead of the local clocks. This is the more general fix but
   touches the timing of every end-to-end test.
