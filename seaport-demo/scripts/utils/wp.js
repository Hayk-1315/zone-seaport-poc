// scripts/utils/wp.js
const { ethers } = require("hardhat");

// Devuelve WP "en unidades", no e18, tal y como tu contrato lo calcula.
async function getWpForToken(WP_ADDR, tokenId, amount) {
  const abi = ["function wpOfTokenId(uint256 tokenId, uint256 amount) view returns (uint256)"];
  const wp = new ethers.Contract(WP_ADDR, abi, ethers.provider);
  const wpUnits = await wp.wpOfTokenId(tokenId, amount);
  return BigInt(wpUnits.toString()); // p.ej. 199 (no con 18 decimales)
}

// ✅ Precio por WP con escala 1e6 (misma escala que USDC):
// p_1e6 = (askUSDC_6dec / 1e6) / WP  * 1e6  = askUSDC_6dec / WP
function pricePerWP_1e6(askUSDC_6dec, wpUnits) {
  const ask = BigInt(askUSDC_6dec); // USDC 6 dec
  const wp  = BigInt(wpUnits);      // unidades WP (enteras)
  return ask / wp;                   // entero con 6 decimales de escala
}

// Pretty helpers
function humanUSDC(ask6) {
  return Number(BigInt(ask6)) / 1e6;
}
function humanPricePerWP(pperWP_1e6) {
  return Number(ethers.formatUnits(pperWP_1e6.toString(), 6));
}

module.exports = {
  getWpForToken,
  pricePerWP_1e6,
  humanUSDC,
  humanPricePerWP,
};
