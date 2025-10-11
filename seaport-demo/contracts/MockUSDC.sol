// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract MockUSDC is ERC20 {
constructor() ERC20("Mock USDC", "mUSDC") {
_mint(msg.sender, 1_000_000_000 * 1e6); // 1,000,000,000 mUSDC (6 decimales)
}


function decimals() public pure override returns (uint8) {
return 6;
}
}
