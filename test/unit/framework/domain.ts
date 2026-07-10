// Domain framework for subsystem ("unit") suites - see test/SUBSYSTEMS.md.
//
// Each folder under test/unit/ owns a domain.ts that calls defineDomain()
// with its variant matrices. defineDomain returns a covers() bound to the
// domain: tests stay NATIVE mocha its, and covers() wraps the body to attach
// typed metadata. The meta is FLAT - field/axis names only, no matrix
// nesting; mapping keys to matrices is the scanner's job, not the author's:
//
//   it("kills a dispute whose forkId is unlinked", covers({
//       forkId: "unlinked",
//       proofType: "DisputeInvalidStateProof",
//       carrier: "signedblocks"
//   }, async function () { ... }));
//
// Resolution: a key claims its option in the (single) variants matrix that
// owns the field, AND completes any product whose axes are all present
// (proofType + carrier above claims the carrierInteraction tuple too). A
// field name may live in at most ONE variants matrix per domain - the
// scanner rejects ambiguous domains. Every key must claim at least one cell.
//
// The meta is typed against the domain, so an unknown key or option is a
// compile error - the type error itself tells the author the valid
// variants. At runtime covers() just returns the body; mocha never knows.
//
// Two matrix kinds:
//
//   variants({ fields }) - the readable per-field form:
//       forkId: ["valid", "unlinked", "cross-fork"]
//     every option of every field needs at least one test; fields do NOT
//     multiply. Include the positive/valid option - the happy path is a
//     variant too.
//
//   product({ axes }) - axes that genuinely interact:
//       proofType x carrier
//     every reachable combination (full tuple) needs a test.
//
// The scanner (scripts/coverage-grid) loads each folder's domain, parses the
// covers() metas in that folder's tests (object literals only - no
// inference), and reports every reachable, unclaimed cell as a gap. Every
// it() in test/unit/** must wrap its body in covers() - an untagged test is
// a scan error. it.skip needs a `blocked:` reason in the meta.

export type AxisOptions = readonly string[];
export type Axes = Record<string, AxisOptions>;

// a product cell = one option per axis (a full variant tuple)
export type Cell<A extends Axes> = { [K in keyof A]: A[K][number] };

export interface ProductRule<A extends Axes = Axes> {
    /** every cell matching all pairs here is unreachable */
    match: Partial<Cell<A>>;
    /** why this is a constraint of the space, not a gap */
    reason: string;
}

export interface ProductMatrix<A extends Axes = Axes> {
    kind: "product";
    /** what this matrix measures, one line */
    desc: string;
    axes: A;
    unreachable?: readonly ProductRule<A>[];
}

// one (field, option) pair that cannot exist
type VariantRule<F extends Axes> = {
    [K in keyof F]: { field: K; option: F[K][number]; reason: string };
}[keyof F];

export interface VariantsMatrix<F extends Axes = Axes> {
    kind: "variants";
    /** what this matrix measures, one line */
    desc: string;
    fields: F;
    /**
     * Happy-path defaults. A defaulted option needs no explicit tag: any
     * live test that engages this matrix without deviating on the field is
     * counted as covering it implicitly (the domain declares that unmentioned
     * = default). Explicitly tagging the default stays allowed for tests
     * whose POINT is the happy path. The report flags fields where ONLY the
     * happy path is covered.
     */
    defaults?: { [K in keyof F]?: F[K][number] };
    unreachable?: readonly VariantRule<F>[];
}

export type Matrix = ProductMatrix | VariantsMatrix;
export type Matrices = Record<string, Matrix>;

// identity helpers so each matrix's `unreachable` is typed against itself
export function product<const A extends Axes>(
    m: Omit<ProductMatrix<A>, "kind">
): ProductMatrix<A> {
    return { kind: "product", ...m };
}

export function variants<const F extends Axes>(
    m: Omit<VariantsMatrix<F>, "kind">
): VariantsMatrix<F> {
    return { kind: "variants", ...m };
}

type FieldsOf<X extends Matrix> =
    X extends ProductMatrix<infer A>
        ? A
        : X extends VariantsMatrix<infer F>
          ? F
          : never;

// every field/axis name of the domain, flattened
type MetaKeys<M extends Matrices> = {
    [N in keyof M]: keyof FieldsOf<M[N]> & string;
}[keyof M];

// the option union for a key, across every matrix that has it
type OptionsFor<M extends Matrices, K extends string> = {
    [N in keyof M]: K extends keyof FieldsOf<M[N]>
        ? FieldsOf<M[N]>[K][number]
        : never;
}[keyof M];

// the covers() meta: FLAT field/axis -> option (arrays allowed for variants
// fields; a product axis takes a single value). `blocked` is the reserved
// it.skip reason - not a valid field name.
export type CoversMeta<M extends Matrices> = {
    [K in MetaKeys<M>]?: OptionsFor<M, K> | readonly OptionsFor<M, K>[];
} & { blocked?: string };

// `this: Mocha.Context` so `this.timeout(...)` inside a test body type-checks
type Body = (this: Mocha.Context) => unknown | Promise<unknown>;

export type CoversFn<M extends Matrices> = (
    meta: CoversMeta<M>,
    fn: Body
) => Mocha.AsyncFunc;

export interface Domain<M extends Matrices = Matrices> {
    subsystem: string;
    matrices: M;
}

// covers() attaches typed coverage metadata to a native mocha it() body.
// At runtime it returns the body untouched; the meta is read statically by
// the scanner.
export function defineDomain<M extends Matrices>(
    spec: Domain<M>
): Domain<M> & { covers: CoversFn<M> } {
    const covers: CoversFn<M> = (meta, fn) => {
        void meta;
        return fn as Mocha.AsyncFunc;
    };
    return { ...spec, covers };
}
