pragma solidity ^0.8.8;

//Used only to test the library - other contracts should use the library directly
contract LibraryTestContract {
    address public libraryAddress;

    constructor(address _libraryAddress) {
        libraryAddress = _libraryAddress;
    }

    // Fallback function that forwards all calls to the library
    fallback() external {
        address implementation = libraryAddress;
        assembly {
            // Copy call data into memory
            calldatacopy(0, 0, calldatasize())

            // Delegate call to the library
            let result := delegatecall(
                gas(),
                implementation,
                0,
                calldatasize(),
                0,
                0
            )

            // Copy returned data
            returndatacopy(0, 0, returndatasize())

            // Return based on success or failure of the call
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
