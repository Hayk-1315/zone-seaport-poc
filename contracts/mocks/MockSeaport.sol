// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// === Añadir estos structs aquí (antes de usarlos) ===
struct ConsiderationItem {
    address recipient;
    uint256 amount;
}

struct Order {
    address offerer;       // quien vende
    address token;         // ERC-1155 address
    uint256 tokenId;       // tokenId ofrecido
    uint256 amount;        // cantidad de ERC-1155 shares
    address zone;          // address de la Zone
    uint256 vmId;          // vmId esperado
    ConsiderationItem[] consideration; // fees/payouts
}

interface IZoneForSeaport {
function validate(Order calldata order) external view returns (bool ok, string memory reason);
}


interface IERC1155Minimal {
function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}


contract MockSeaport {
event OrderFulfilled(address indexed offerer, address indexed zone, address token, uint256 tokenId, uint256 amount);


// Para el PoC, tratamos un único tipo de orden simplificado
function fulfillOrder(Order calldata order, address recipient) external {
(bool ok, string memory reason) = IZoneForSeaport(order.zone).validate(order);
require(ok, reason);


// Transferencia mock: movemos el ERC-1155 del offerer -> recipient
// NOTA: en un Seaport real habría más lógica, approvals, etc.
IERC1155Minimal(order.token).safeTransferFrom(order.offerer, recipient, order.tokenId, order.amount, "");


emit OrderFulfilled(order.offerer, order.zone, order.token, order.tokenId, order.amount);
}
}