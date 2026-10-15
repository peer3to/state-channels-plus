// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "./ConsoleImportRelay.sol";

/**
 * @title ConsoleImportProbe
 * @dev Test-only contract that reaches the development console library through
 * an import, so the console-import scan has a real compiled positive case.
 */
contract ConsoleImportProbe {}
