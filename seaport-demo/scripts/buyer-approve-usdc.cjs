#!/usr/bin/env node
/**
 * Buyer USDC approve for Seaport spender
 * - For the PoC we keep it simple: infinite approve (MAX_UINT256).
 * - We can pass amount if we want a finite allowance.
 */

const { ethers } = require('ethers');
require('dotenv').config();

const ERC20_ABI = [
  // Minimal ERC20 ABI for approve/allowance/decimals
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() view returns (uint8)',
];

(async () => {
  const args = require('minimist')(process.argv.slice(2));
  const rpc = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
  const usdcAddr = process.env.USDC_ADDR;
  // If we use conduitKey=0x0, spender is the Seaport contract itself
  const spender = process.env.SEAPORT_ADDR; // Seaport v1.5 address on Sepolia

  if (!rpc || !usdcAddr || !spender) {
    console.error('Missing env: SEPOLIA_RPC_URL, USDC_ADDR, SEAPORT_SPENDER_ADDR');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const buyer = new ethers.Wallet(process.env.BUYER_PK, provider);

  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, buyer);
  const decimals = await usdc.decimals();

  let amount;
  if (args.amount) {
    // User-provided amount (in human units)
    amount = ethers.parseUnits(String(args.amount), decimals);
  } else {
    // Infinite approve for PoC
    amount = ethers.MaxUint256;
  }

  console.log(`Approving USDC for spender ${spender}...`);
  const tx = await usdc.approve(spender, amount);
  console.log('⏳ Waiting for confirmation...', tx.hash);
  await tx.wait();
  console.log('✅ Approved.');
})();
