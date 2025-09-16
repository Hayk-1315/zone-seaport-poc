// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WPERC1155
 * @notice Minimal ERC-1155 for the PoC. It encodes tokenId as (vmId, outcomeIndex, timeslot),
 *         and exposes a simple linear beta model: beta starts at betaOpen at tOpen, then goes
 *         down linearly to 1.0 at tClose. After tClose it's clamped to 1.0, and before tOpen
 *         it's clamped to betaOpen.
 *
 *         This is not the full contract. It is just enough to mint balances per (vm, outcome, timeslot)
 *         and compute winning power = amount * beta
 */
contract WPERC1155 is ERC1155, Ownable {
    struct VmConfig {
        uint32 tOpen;         // when beta starts decreasing
        uint32 tClose;        // when beta reaches 1.0
        uint256 betaOpen_e18; // e18 scale, e.g. 1.50e18 = 1.5
        bool tradable;        // quick flag to allow/deny trading in the PoC
    }

    event UserCommitment(
    uint256 indexed vmId,
    address indexed committer,
    uint8 outcomeIndex,
    uint32 timeslot,
    uint256 amount
);

    
    mapping(uint256 => VmConfig) public vmCfg; // vmId -> config
    mapping(uint256 => uint8) public vmOutcomeCount; // vmId => number of outcomes 
    mapping(uint256 => string[]) public vmOutcomeTitles; // vmId => outcome titles


    // Empty URI (we don't need metadata for this PoC). We can set a real URI later if you want.
    constructor() ERC1155("") {}

    function isValidVmId(uint256 vmId) public pure returns (bool) {
        // lower 5 bytes must be zero to be a valid VM id (same convention as core)
        return vmId & 0xff_ff_ff_ff_ff == 0;
    }

    function vmOutcomeTimeslotIdOf(uint256 validVmId, uint8 outcomeIndex, uint256 timeslot)
        public
        pure
        returns (uint256 tokenId)
    {
        require(isValidVmId(validVmId), "vmId invalid (low 5 bytes must be 0)");
        require(outcomeIndex <= type(uint8).max, "outcome OOB");
        require(timeslot <= type(uint32).max, "timeslot OOB");

        // tokenId = [27 bytes vmId][1 byte outcome][4 bytes timeslot]
        tokenId = uint256(
            bytes32(
                abi.encodePacked(
                    bytes27(bytes32(validVmId)),
                    bytes1(outcomeIndex),
                    bytes4(uint32(timeslot))
                )
            )
        );
    }

    function destructure(uint256 tokenId)
        public
        pure
        returns (uint256 vmId, uint8 outcomeIndex, uint32 timeslot)
    {
        // vmId is the upper 27 bytes (lower 5 bytes zeroed)
        vmId = tokenId & ~uint256(0xff_ff_ff_ff_ff);
        // next 1 byte
        outcomeIndex = uint8((tokenId >> 32) & 0xff);
        // last 4 bytes
        timeslot = uint32(tokenId & 0xff_ff_ff_ff);
    }

    // -------- VM config --------

    function setVmConfig(
        uint256 vmId,
        uint32 tOpen,
        uint32 tClose,
        uint256 betaOpen_e18,
        bool tradable,
        uint8 nOutcomes
    ) external onlyOwner {
        require(isValidVmId(vmId), "vmId invalid");
        require(tOpen < tClose, "tOpen must be < tClose req");
        require(betaOpen_e18 >= 1e18, "betaOpen must be >= 1.0"); // 1e18 = 1.0 in fixed-point
        require(nOutcomes >= 2 && nOutcomes <= type(uint8).max, "nOutcomes must be at least 2");

        vmOutcomeCount[vmId] = nOutcomes;
        vmCfg[vmId] = VmConfig({ tOpen: tOpen, tClose: tClose, betaOpen_e18: betaOpen_e18, tradable: tradable });
    }

    function setVmOutcomeTitles(uint256 vmId, string[] calldata titles) external onlyOwner {
    require(titles.length == vmOutcomeCount[vmId], "titles length mismatch");
    vmOutcomeTitles[vmId] = titles;
    }

    function setTradable(uint256 vmId, bool v) external onlyOwner {
        vmCfg[vmId].tradable = v;
    }

    // -------- Beta & Winning Power --------

    /**
     * @notice beta(t) in e18 scale:
     *         - before or at tOpen => betaOpen
     *         - after or at tClose => 1.0
     *         - in between => linear from betaOpen down to 1.0
     */
    function betaOf(uint256 vmId, uint256 t) public view returns (uint256) {
        VmConfig memory c = vmCfg[vmId];
        require(c.tOpen != 0, "vm not configured");

        if (t <= c.tOpen) {
            return c.betaOpen_e18; // clamp to betaOpen before tOpen
        }
        if (t >= c.tClose) {
            return 1e18; // clamp to 1.0 after tClose
        }

        // Linear: beta = 1e18 + (betaOpen - 1e18) * (tClose - t) / (tClose - tOpen)
        uint256 num = (c.betaOpen_e18 - 1e18) * (c.tClose - t);
        uint256 den = (c.tClose - c.tOpen);
        return 1e18 + (num / den);
    }

    /**
     * @notice WP (winning power) for a given tokenId and amount:
     *         WP_e18 = amount * beta / 1e18
     */
    function wpOfTokenId(uint256 tokenId, uint256 amount) public view returns (uint256 wp_e18) {
        (uint256 vmId, , uint32 timeslot) = destructure(tokenId);
        uint256 beta = betaOf(vmId, timeslot);
        wp_e18 = (amount * beta) / 1e18;
    }

    // -------- PoC mint (simulate commit) --------

    /**
     * @notice For the PoC we mint balances per (vmId, outcome, timeslot). This simulates primary commits
     *         so that sellers can later list these shares in Seaport.      
     */
    function mintCommit(
        address to,
        uint256 vmId,
        uint8 outcomeIndex,
        uint256 amount
    ) external {
        VmConfig memory c = vmCfg[vmId];
        require(c.tOpen != 0, "vm not configured");
        require(c.tradable, "vm not tradable");
        require(block.timestamp < c.tClose, "commit period closed");
        
        uint8 n = vmOutcomeCount[vmId];
        require(n >= 2, "vm has no outcomes");
        require(outcomeIndex < n, "outcomeIndex out of range");

        // timeslot = max(tOpen, now)
        uint32 timeslot = uint32(block.timestamp < c.tOpen ? c.tOpen : block.timestamp);

        uint256 id = vmOutcomeTimeslotIdOf(vmId, outcomeIndex, timeslot);
        _mint(to, id, amount, "");

        emit UserCommitment(vmId, to, outcomeIndex, timeslot, amount);
    }
}