import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";
import getProviderUrl from "./getProviderUrl.js";


fs.copyFileSync("../contracts.json", "./src/contracts.json");

//copy injectHyperswarm.js to build/static/js
fs.copyFileSync(
  "../artifacts/contracts/TicTacToe/TicTacToeStateMachine.sol/TicTacToeStateMachine.json",
  "./src/TicTacToeStateMachine.json"
);
// Copy entire directory
fs.copySync("../typechain-types", "./src/stateChannel/typechain-types", { overwrite: true }, (err) => {
  if (err) {
    console.error("Error copying typechain-types:", err);
  }
});


//Create providerConfig

const providerUrl = getProviderUrl();
const providerConfig = {
  providerUrl
};
// Write providerConfig.json to ./src directory
const providerConfigPath = path.resolve("./src/providerConfig.json");
fs.writeFileSync(providerConfigPath, JSON.stringify(providerConfig, null, 2));