// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title MockERC1155Market
 * @dev Mock minimal de un "mercado" ERC-1155 que nos deja:
 *  - Asignar vmId a cada tokenId (solo la primera vez)
 *  - Marcar VMs como tradables o no
 *  - Consultar existencia (supply > 0)
 *   Lo llama el seller (offerer): para mintear sus shares (función mint) y para dar approval a Seaport (función heredada setApprovalForAll). Y lo llama La Zone para leer metadatos del market: tokenVmOf(tokenId) y isTradable(vmId). Y lo llama MockSeaport para transferir los shares cuando la Zone valida: safeTransferFrom(offerer → buyer) (ERC-1155 estándar).
 */
contract MockERC1155Market is ERC1155 {
    mapping(uint256 => uint256) public tokenVmOf;   // tokenId -> vmId
    mapping(uint256 => bool)    public vmTradable;  // vmId -> tradable?
    mapping(uint256 => uint256) public totalSupply; // tokenId -> supply

    constructor() ERC1155("") {}

    function setTradable(uint256 vmId, bool t) external {
        vmTradable[vmId] = t;
    }

    function isTradable(uint256 vmId) external view returns (bool) {
        return vmTradable[vmId];
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return totalSupply[tokenId] > 0;
    }

    function mint(
        address to,
        uint256 tokenId,
        uint256 amount,
        uint256 vmId
    ) external {
        uint256 assignedVm = tokenVmOf[tokenId];
        if (assignedVm == 0) {
            // Permitimos vmId == 0? Para el PoC mejor NO: vmId debe ser > 0
            require(vmId != 0, "vmId=0 invalid");
            tokenVmOf[tokenId] = vmId;
        } else {
            require(assignedVm == vmId, "vmId mismatch");
        }
        _mint(to, tokenId, amount, "");
        totalSupply[tokenId] += amount;
    }

    function burn(address from, uint256 tokenId, uint256 amount) external {
        _burn(from, tokenId, amount);
        totalSupply[tokenId] -= amount;
    }
}
