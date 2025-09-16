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

  // Escanear TransferSingle hacia y desde seller
  const filter = wp.filters.TransferSingle(null, null, null);
  
  // --- chunked scan to respect Alchemy Free 10-block limit ---
  
  const latest = await provider.getBlockNumber();
  let from = 9208445; // o el bloque de deploy si lo conoces para acelerar
  maxRange = 8;
  let logs = [];
  while (from <= latest) {
  const to = Math.min(from + maxRange, latest);
  const chunk = await wp.queryFilter(filter, from, to);
  logs = logs.concat(chunk);
  from = to + 1;
}
// -----------------------------------------

  // Calcular balances por tokenId del seller (muy simple: contamos entradas - salidas)
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

  // Guardar sólo los tokenIds con balance > 0
  const owned = [...balances.entries()]
    .filter(([, bal]) => bal > 0n)
    .map(([tokenId, bal]) => ({ tokenId, balance: bal.toString() }));

  console.log("\nTokenIds owned by SELLER:");
  console.table(owned);

  // Generar un config base para listings (askUSDC_6dec a rellenar)
  const baseCfg = owned.map(({ tokenId, balance }) => ({
    tokenId,
    amount: balance,       // por defecto vende todo
    askUSDC_6dec: "10000000" // placeholder: 10.000000 USDC, luego lo editas
  }));

  const outPath = path.join(__dirname, "../data/listings.config.js");
  const js = `module.exports = ${JSON.stringify(baseCfg, null, 2)};\n`;
  fs.writeFileSync(outPath, js);

  console.log(`\nWrote ${outPath} – edita askUSDC_6dec para tus ratios.\n`);
  console.log("Tip: si tu WP tiene wpOfTokenId(tokenId, amount), puedes calcular WP y p/WP en un script aparte para decidir precios.");
}

main().catch((e) => { console.error(e); process.exit(1); });
