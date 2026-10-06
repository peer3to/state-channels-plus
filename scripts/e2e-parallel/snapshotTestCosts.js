/* eslint-disable no-console */
// Copy every test's latest measured cost from the cache into the committed
// test-costs.json, without the drift threshold a run applies.
// usage: yarn test:costs:snapshot [--cost-cache <path>]
const {
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COSTS_PATH
} = require("./shared/constants");
const { refreshCosts } = require("./shared/costCache");

function main(argv) {
    let cachePath = DEFAULT_COST_CACHE_PATH;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== "--cost-cache")
            throw new Error(`Unknown option: ${argv[i]}`);
        cachePath = argv[++i];
        if (!cachePath) throw new Error("--cost-cache requires a path");
    }
    const count = refreshCosts({ cachePath });
    console.log(`Wrote ${count} task costs to ${DEFAULT_COSTS_PATH}`);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
