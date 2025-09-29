// scripts/sepolia-scan-holdings.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const WP_ADDR = process.env.WP_ADDR;
  if (!WP_ADDR) throw new Error("Missing WP_ADDR in .env");

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const seller = new ethers.Wallet(process.env.SELLER_PK, provider);

  const wpAbi = [
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
    "function balanceOf(address a, uint256 id) view returns (uint256)",
    "function wpOfTokenId(uint256 tokenId, uint256 amount) view returns (uint256)", // si lo tienes en tu WP
  ];
  const wp = new ethers.Contract(WP_ADDR, wpAbi, provider);

  // Scan TransferSingle to and from seller
  const filter = wp.filters.TransferSingle(null, null, null);
  
  // --- chunked scan to respect Alchemy Free 10-block limit ---
  
  const latest = await provider.getBlockNumber();
  let from = 9302054; // the deploy block
  maxRange = 8;
  let logs = [];
  while (from <= latest) {
  const to = Math.min(from + maxRange, latest);
  const chunk = await wp.queryFilter(filter, from, to);
  logs = logs.concat(chunk);
  from = to + 1;
}

 // Calculate balances per tokenId of seller (count ins - outs)
  const zero = "0x0000000000000000000000000000000000000000".toLowerCase();
  const addr = seller.address.toLowerCase();
  const balances = new Map();

  for (const log of logs) {
    const { from, to, id, value } = log.args;
    const tId = id.toString();
    const v = BigInt(value.toString());

    if (to.toLowerCase() === addr) {
      balances.set(tId, (balances.get(tId) ?? 0n) + v);
    }
    if (from.toLowerCase() === addr) {
      balances.set(tId, (balances.get(tId) ?? 0n) - v);
    }
  }

  // Store only the tokenIds with balance > 0
  const owned = [...balances.entries()]
    .filter(([, bal]) => bal > 0n)
    .map(([tokenId, bal]) => ({ tokenId, balance: bal.toString() }));

  console.log("\nTokenIds owned by SELLER:");
  console.table(owned);

  // Generate a base config for listings (askUSDC_6dec to edit later)
  const baseCfg = owned.map(({ tokenId, balance }) => ({
    tokenId,
    amount: balance,       // sell all
    askUSDC_6dec: "10000000" // placeholder: 10.000000 USDC. We have to edit this and put random number in "../data/listings.config.js"
  }));

  const outPath = path.join(__dirname, "../data/listings.config.js");
  const js = `module.exports = ${JSON.stringify(baseCfg, null, 2)};\n`;
  fs.writeFileSync(outPath, js);

  console.log(`\nWrote ${outPath} – edit askUSDC_6dec - random numbers.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
