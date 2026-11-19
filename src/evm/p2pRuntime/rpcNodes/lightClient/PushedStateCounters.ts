/** How the storage of the followed contracts was kept, since the provider started. */
export type PushedStateCounters = {
    /** Pushed blocks whose proof held. */
    acceptedBlocks: number;
    /** Pushed blocks refused; each is logged as an error. */
    refusedBlocks: number;
    /**
     * Times a followed contract's held storage was proven again in one read:
     * the pushed blocks did not reach the read's block, or the interval was
     * over.
     */
    reproofs: number;
    /**
     * Slots a proof found changed although every block since was pushed
     * without a write of them; each proof that finds some is logged as a
     * warning.
     */
    changedUnpushed: number;
};
