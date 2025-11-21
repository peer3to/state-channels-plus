// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;
struct ComplexType {
  uint a;
  uint b;
}
contract Counter {
  uint public x;
  ComplexType public complex;

  event Increment(uint by);

  function inc() public returns (uint) {
    x++;
    emit Increment(1);
    return x;
  }

  function incBy(uint by) public {
    require(by > 0, "incBy: increment should be positive");
    x += by;
    emit Increment(by);
  }
  function setComplex(uint a, uint b) public returns (ComplexType memory) {
    complex = ComplexType(a, b);
    return complex;
  }
}
