# Clock.ts

> **Source:** [src/Clock.ts](../../../../../src/Clock.ts)
>
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-TIME-1-FM4651` (Chain time is authoritative)](../../../specification/protocol-model/time.md#req-time-1-fm4651)
- [`REQ-TIME-2-VG94S7` (Honest participants keep estimated chain time within the skew bound)](../../../specification/protocol-model/time.md#req-time-2-vg94s7)
  Partial: `syncClock` runs only from `init`, with no periodic resynchronization, and no numeric skew bound exists ([`OQ-8-PEYAAQ` (Clock-skew and bias values)](../../../specification/open-questions.md#oq-8-peyaaq)).
- [`REQ-TIME-5-S9NQXK` (Every local contract execution observes the runtime's current estimated chain…)](../../../specification/protocol-model/time.md#req-time-5-s9nqxk)
- [`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)

## UNIT-TEST-CLOCK-1-6K546K

Initialization and handover

- Setup: Call `Clock.init` with identical, replacement, failed, and overlapping providers
- Oracle: One usable owner is published; failed or pending replacement never creates an uninitialized interval or claims ownership

- [x] `UNIT-TEST-CLOCK-1-6K546K.P1` — overlapping calls for one provider share initialization
- [x] `UNIT-TEST-CLOCK-1-6K546K.P2` — a synchronized replacement becomes the live owner and serves reads
- [x] `UNIT-TEST-CLOCK-1-6K546K.P3` — failed replacement does not take ownership and a later live replacement succeeds
- [ ] `UNIT-TEST-CLOCK-1-6K546K.P4` — reads during replacement continue through the previous initialized instance until atomic cutover
- [x] `UNIT-TEST-CLOCK-1-6K546K.P5` — overlapping different-provider initializations settle on one usable owner

## UNIT-TEST-CLOCK-RELEASE-1-B836QF

Released provider lifecycle

- Setup: Init with a provider, release it or not, then init with another provider
- Oracle: A released provider is destroyed once replaced; an owned one is kept

- [x] `UNIT-TEST-CLOCK-RELEASE-1-B836QF.P1` — released provider destroyed on replacement
- [x] `UNIT-TEST-CLOCK-RELEASE-1-B836QF.P2` — owned provider kept on replacement
