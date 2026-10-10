// hardhat.config.ts as compiled into the test tree; the parallel runner's
// compiled-mode children load it so hardhat never starts ts-node
module.exports = require("./dist/hardhat.config.js").default;
