pragma solidity ^0.8.8;

import "../types/DataTypes.sol";

/// @dev The stateless helpers `StateChannelCommon` calls on the deployed utility
/// facet. `UtilityFacet` implements it, but `UtilityFacet` also derives from
/// `StateChannelCommon` (its state views are delegatecalled through the proxy),
/// so `StateChannelCommon` cannot name the concrete type without a definition
/// cycle - it binds this interface to `utilityFacetAddress` instead.
abstract contract UtilityFacetInterface {
    function tryDecodeBlock(bytes memory encodedBlock)
        public
        view
        virtual
        returns (bool decoded, Block memory blockData);

    function retrieveSignerAddress(bytes memory encodedData, bytes memory signature)
        public
        pure
        virtual
        returns (address, bool);

    function isAddressInArray(address[] memory array, address adr) public pure virtual returns (bool);

    function subtractAddressArrays(address[] memory array1, address[] memory array2)
        public
        pure
        virtual
        returns (address[] memory);

    function concatAddressArraysNoDuplicates(address[] memory array1, address[] memory array2)
        public
        pure
        virtual
        returns (address[] memory);

    function insertIntoAddressArrayNoDuplicates(address[] memory array, address newAddress)
        public
        pure
        virtual
        returns (address[] memory);

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public pure virtual returns (bool);
}
