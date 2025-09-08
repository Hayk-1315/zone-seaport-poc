// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMarket1155 {
    function tokenVmOf(uint256 tokenId) external view returns (uint256);
    function isTradable(uint256 vmId) external view returns (bool);
}

struct ConsiderationItem { address recipient; uint256 amount; }

struct Order {
    address offerer;       // quien vende
    address token;         // ERC-1155 address
    uint256 tokenId;       // tokenId ofrecido
    uint256 amount;        // cantidad de ERC-1155 shares
    address zone;          // address de la Zone (este contrato)
    uint256 vmId;          // vmId esperado
    ConsiderationItem[] consideration; // fees y/o payouts fuera del buyer
}

interface IZone {
    function validate(Order calldata order) external view returns (bool ok, string memory reason);
}

/**
 * @title ZoneMinimal
 * @dev Valida:
 *  (1) El token pertenece al market esperado
 *  (2) tokenId -> vmId coincide
 *  (3) vmId está en estado tradable
 *  (4) (Opcional) recipients requeridos aparecen en consideration[]
 */
contract ZoneMinimal is IZone {
    address public immutable market; // MockERC1155Market

    // Lista de recipients requeridos (p.ej. protocol fee, owner fee)
    address[] public requiredRecipients;

    constructor(address market_, address[] memory requiredRecipients_) {
        require(market_ != address(0), "market=0");
        market = market_;
        requiredRecipients = requiredRecipients_;
    }

    function requiredRecipientsLength() external view returns (uint256) {
        return requiredRecipients.length;
    }

    function validate(Order calldata order)
        external
        view
        override
        returns (bool ok, string memory reason)
    {

        // (0) checks defensivos opcionales
        if (order.zone != address(this)) {
        return (false, "wrong zone");
    }
        if (order.offerer == address(0)) {
        return (false, "offerer=0");
    }
        if (order.amount == 0) {
        return (false, "amount=0");
    }

        // (1) Token pertenece al market esperado
        if (order.token != market) {
            return (false, "token not our market");
        }

        // (2) vmId correcto para ese tokenId
        uint256 vm = IMarket1155(market).tokenVmOf(order.tokenId);
        if (vm == 0 || vm != order.vmId) {
            return (false, "vmId mismatch or zero");
        }

        // (3) vm en estado tradable
        if (!IMarket1155(market).isTradable(order.vmId)) {
            return (false, "VM not tradable");
        }

        // (4) recipients requeridos presentes si se configuraron
        if (requiredRecipients.length > 0) {
            for (uint256 i = 0; i < requiredRecipients.length; i++) {
                address req = requiredRecipients[i];
                bool found;
                for (uint256 j = 0; j < order.consideration.length; j++) {
                    if (order.consideration[j].recipient == req && order.consideration[j].amount > 0) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return (false, "missing required recipient");
                }
            }
        }

        return (true, "");
    }
}