// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

/**
 * An ERC-20 for the light client's tests: a channel's contract reading a
 * balance it holds, whose storage no channel transaction touches. Its
 * deployer holds the whole supply. Self-contained: importing a library's
 * ERC-20 adds its error interfaces to the generated contract types.
 */
contract LightClientToken {
    string public constant name = "Light Client Token";
    string public constant symbol = "LCT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        totalSupply = 1000;
        balanceOf[msg.sender] = 1000;
        emit Transfer(address(0), msg.sender, 1000);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
