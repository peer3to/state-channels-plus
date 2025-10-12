export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 1000,
    pollIntervalMs: number = 5
): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const result = await condition();
            if (result) {
                return;
            }
        } catch (error) {
            // Continue polling even if condition throws
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Wait for P2P connections to be established
 */
export async function waitForP2PConnections(
    p2pOne: any,
    p2pTwo: any,
    timeoutMs: number = 2000
): Promise<void> {
    await waitFor(() => {
        const connections1 = p2pOne.p2pSigner.p2pManager.openConnections.length;
        const connections2 = p2pTwo.p2pSigner.p2pManager.openConnections.length;
        return connections1 > 0 && connections2 > 0;
    }, timeoutMs);
}

/**
 * Wait for state synchronization between peers
 */
export async function waitForStateSync(
    stateManager1: any,
    stateManager2: any,
    timeoutMs: number = 1000
): Promise<void> {
    await waitFor(() => {
        const latestBlock1 = stateManager1.storage.blocks.getLatestBlock(
            stateManager1.forkId
        );
        const latestBlock2 = stateManager2.storage.blocks.getLatestBlock(
            stateManager2.forkId
        );
        // Both must have blocks AND they must have the SAME block hash
        return (
            latestBlock1 !== undefined &&
            latestBlock2 !== undefined &&
            latestBlock1.hash === latestBlock2.hash
        );
    }, timeoutMs);
}

/**
 * Wait for a specific number of blocks to be processed
 */
export async function waitForBlocks(
    stateManager: any,
    expectedCount: number,
    timeoutMs: number = 1000
): Promise<void> {
    await waitFor(() => {
        const blockCount = stateManager.storage.blocks.getBlockCount(
            stateManager.forkId
        );
        return blockCount >= expectedCount;
    }, timeoutMs);
}
