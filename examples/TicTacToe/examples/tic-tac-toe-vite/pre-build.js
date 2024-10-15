import fs from "fs";

fs.copyFileSync("../../contracts.json", "./src/contracts.json");

//copy injectHyperswarm.js to build/static/js
fs.copyFileSync(
  "../../artifacts/contracts/TicTacToe/TicTacToeStateMachine.sol/TicTacToeStateMachine.json",
  "./src/TicTacToeStateMachine.json"
);
