pragma solidity ^0.8.8;

import "./Console.sol";

library console {
    Console constant CONSOLE = Console(0x0000000000000000000000000000000000000001);

    function log(string memory message) internal view {
        CONSOLE.log(message);
    }
}
