# E2E tests to add

Tests that would strengthen coverage of the block-queue redesign (PR: block-queue CRDT redesign +
PR #384 fixes). Each needs a real dispute + on-chain reduction staged deterministically, which is the
dispute-heavy class that flakes on the sandbox (the harness stalls under load and tests fail for
environmental reasons, not logic). They're better authored/run on a machine that can sustain the load.

---

## 1. An N-block junk flood is gated to one kill-period read while unexpired, one recovery after expiry

**Scenario.** Our own current fork is under an active dispute. A byzantine peer floods us with many block
confirmations, each on a different bogus fork — first while the dispute's kill period has **not** yet
expired, then again after it expires.

**Expected.** Our node must:

- **While unexpired:** schedule **zero** background local-reduction attempts across all N incoming blocks
  (`maybeScheduleForkRecovery` returns after caching the suppression window when `isExpired` is false),
  and make only **one** on-chain "is the kill period expired?" read (subsequent junk reuses the cached
  answer, it does not each hit the chain).
- **After expiry:** a further junk burst schedules exactly **one** coalesced local-reduction attempt for
  the fork.

**Why it matters.** Without the per-fork recovery gate + the kill-period cache, a flood would schedule a
task and an on-chain read per junk block — an amplification vector. The existing single-block test
already proves one local reduction for one wrong-fork block; this test must prove the N-block gate (no
recovery while suppressed), the cached kill-period read, and the single coalesced recovery after expiry.

**How to stage.** Put the node's current fork into dispute with the kill period not yet expired; stub the
recovery reduction to a no-op that counts calls, and count on-chain kill-period reads. Ingest N distinct
bogus-fork blocks and assert scheduled-recovery count == 0 and kill-period-read count == 1. Then advance
past kill-period expiry, ingest another junk burst, and assert exactly one coalesced recovery is scheduled.

---

## 2. A block on a fork we've truly moved past is dropped silently

**Scenario.** Our node genuinely reduces past an old fork — a real, finalized on-chain reduction, so we
now hold the reduced fork's genesis snapshot and the old fork is disputed/behind us. A late block then
arrives on that **old** fork.

**Expected.** At the block's queue timeout the entry is **dropped silently**: no sync request is sent
and the honest peer that supplied it is **not** blacklisted (it was just a straggler on a fork we
already left).

**Why it matters.** This is the "known stale fork" half of the timeout decision. A node recognizes the
old fork as canonical-past (it's disputed OR we hold its genesis snapshot) and must not punish honest
peers for it. The **opposite** half — a block on an **unknown** fork is **restored and later
sync-probed, never silently dropped** — is already covered by the updated
`E2E-BlockQueueManager` tests ("queues an unknown-fork block for sync…", "never validates an entry whose
fork is not current").

**How to stage.** Drive a real dispute + resolve/reduce so the node transitions to a reduced fork. Then
ingest a block on the pre-reduction fork with a `senderAddress`. Wait past the queue window. Assert: the
block is gone from the queue, no `spectateService.sync` was fired for it, and the sender is not
blacklisted.

---

## 3. An honest co-participant isn't punished at channel open

**Scenario.** A co-participant sends their very first block (height 0) a moment **before** our node has
finished setting up its own starting genesis state (our `forkId` is still unset).

**Expected.** Our node does **not** blacklist or disconnect that co-participant. The block is simply
queued until our genesis is set, then processed normally.

**Why it matters.** This was the original blocking bug (#1): the old arrival-time sync fired a sync
request at the honest author before genesis was set, and a sync timeout blacklisted them. The redesign
makes this correct by construction — the node **no longer sends any sync request on block arrival at
all** (sync happens only at the queue timeout). The "no arrival-time sync" property is already asserted
by the updated unknown-fork test, so a dedicated pre-genesis test is lower priority; add it as an
explicit regression guard for the exact race.

**How to stage.** Hold/delay the observer's genesis setup, ingest an honest co-participant's height-0
block during that window (with the author as `senderAddress`), then let genesis complete. Assert: the
author is never blacklisted, the node stays connected to it, and the block is processed once genesis is set.

---

## Preferred minimum before merge (host-side, not full dispute e2e)

Test #1 above (junk-flood gated to one kill-period read while unexpired, one recovery after expiry) is
the DoS invariant this redesign introduces. A lighter, more deterministic **host-side** integration check
(via `execOnHost`, in the style of the existing `E2E-BlockQueueManager` "never validates…" test) would
pin it without the full dispute pipeline: stub `isForkDisputed` → true for the current fork, count
`isKillPeriodExpired` chain reads and scheduled `runForkRecovery` tasks while ingesting N distinct
bogus-fork blocks. While the kill period is unexpired, assert one chain read and zero recoveries; after
advancing past expiry, ingest another burst and assert one coalesced recovery. Same idea can pin the B6
kill-period cache (N kicks → 1 chain read).

## Follow-up: CRDT attribution ordering (not shipped)

The structural cap in `QueueStorage` (`MAX_ENTRY_SOURCES`) bounds memory and never invalidates a valid
block, but it is **first-retained**: after a junk-first flood fills `signatureSources` / `sourcePeers`,
a _later_ supplier of a stray/invalid confirmation signature can be absent from the maps, so
`disconnectPeersForSignatures` has nobody to cut — an attribution-evasion vector (not a correctness
bug; the block still processes). Fix options: (a) participant-aware selection (prefer known
participant-union signatures once the set is known); or (b) a bounded per-supplier overflow bucket kept
purely for attribution/punishment. Deferred alongside the future rate-limiter.

## Accepted AGENTS exception (user-approved)

The three e2e scenarios above are peer-observable `src/` behavior; AGENTS asks for same-pass e2e. They
are **deferred by explicit user acceptance** because they need real dispute + on-chain reduction
staging that trips the sandbox event-loop watchdog, producing environmental (not logic) failures. Run
condition: a machine that can sustain `test:parallel` without watchdog throttling.
