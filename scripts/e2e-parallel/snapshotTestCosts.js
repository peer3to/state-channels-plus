/* eslint-disable no-console */
// Refresh the committed task-cost snapshot from this checkout's cost cache.
// usage: yarn test:costs:snapshot [--cost-cache <path>]
const {
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COST_SNAPSHOT_PATH
} = require("./shared/constants");
const { refreshSnapshot } = require("./shared/costCache");

function main(argv) {
    let cachePath = DEFAULT_COST_CACHE_PATH;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== "--cost-cache")
            throw new Error(`Unknown option: ${argv[i]}`);
        cachePath = argv[++i];
        if (!cachePath) throw new Error("--cost-cache requires a path");
    }
    const count = refreshSnapshot({ cachePath });
    console.log(`Wrote ${count} task costs to ${DEFAULT_COST_SNAPSHOT_PATH}`);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
