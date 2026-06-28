// scenario() wraps mocha's it() with coverage metadata.
export const INVARIANT_DESCS = {
    "no-honest-loss":
        "an honest participant is never slashed, removed, or drained",
    "no-attacker-profit":
        "an attacker's withdrawable never exceeds what they deposited",
    conservation: "total withdrawable <= total deposited (no value is minted)",
    liveness:
        "any defense an honest peer needs can always execute; an attacker can't force-revert it",
    "attacker-pays":
        "every malicious action reverts, no-ops, or slashes the attacker - never free griefing",
    authority:
        "only authorized callers (a participant, or the contract itself) can mutate channel state"
} as const;

export type Invariant = keyof typeof INVARIANT_DESCS;

// the SETUP axis: the channel/dispute pre-condition the path runs under
export const SETUP_FACETS = {
    // the proof's carrier shape: EITHER signedBlocks-only OR milestones-only OR neither (genesis)
    proof: ["genesis", "signedblocks", "milestones"],
    // whether on-chain calldata was posted alongside the dispute
    calldata: ["posted", "absent"],
    // the killing auditor's local state when it fires the fraud proof
    auditor: ["synced", "disconnected-stale"]
} as const;

export const SETUP_FACET_DESCS = {
    proof: "what the disputed state proof contains — genesis (empty proof, disputer at fork genesis) · signedblocks (signedBlocks-only) · milestones (milestones-only). a 'both arrays' proof is invalid, not a carrier (see the stateProof:both-arrays-present tamper)",
    calldata:
        "whether calldata was posted on-chain with the dispute — posted · absent",
    auditor:
        "whether the peer that catches the fraud was online & synced, or disconnected with stale local data so it must catch it via on-chain events — synced · disconnected-stale"
} as const;

// the valid `facet:class` strings, e.g. "proof:milestones" | "calldata:absent"
export type Setup = {
    [F in keyof typeof SETUP_FACETS]: `${F & string}:${(typeof SETUP_FACETS)[F][number]}`;
}[keyof typeof SETUP_FACETS];

export interface ScenarioMeta {
    /** the named security property this test protects */
    invariant?: Invariant | Invariant[];
    /** "Struct.field:class" — only when the class isn't set by a typed byzantine helper */
    target?: string | string[];
    /** "facet:class" — the channel/dispute pre-condition (proof shape, calldata path) that
     *  distinguishes this test from a sibling at the same input cell. one or many. */
    setup?: Setup | Setup[];
    /** the asserted fraud-proof enum. usually inferred from the body — tag it only when the
     *  test asserts the proof is ABSENT (a false-positive guard), where inference can't see it */
    proof?: string;
    /** the StateProofVerification result the test asserts (Valid / InvalidProof / …) */
    outcome?: string;
    /** why this is N/A (a constraint, not a gap) — pairs with scenario.skip */
    unreachable?: string;
}

// `this: Mocha.Context` so `this.timeout(...)` inside a test body type-checks.
type Body = (this: Mocha.Context) => unknown | Promise<unknown>;

// `scenario` IS the test: it's `it(title, fn)` plus the coverage metadata. At runtime
// it just registers the mocha test; the `meta` is read statically by the coverage grid.
export function scenario(title: string, meta: ScenarioMeta, fn: Body): void {
    void meta;
    it(title, fn as Mocha.AsyncFunc);
}
scenario.skip = (title: string, meta: ScenarioMeta, fn?: Body): void => {
    void meta;
    it.skip(title, fn as Mocha.AsyncFunc);
};
scenario.only = (title: string, meta: ScenarioMeta, fn: Body): void => {
    void meta;
    it.only(title, fn as Mocha.AsyncFunc);
};
