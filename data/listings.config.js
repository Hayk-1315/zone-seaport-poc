// data/listings.config.js
// Simple "intents" que luego el script convierte en listings reales
// seller: alias del signer en el script
// outcomeIndex: 0 o 1 (usamos 1 en el demo)
// amount: unidades ERC-1155 a vender (BigInt)
// askUSDC_6dec: precio total en USDC con 6 decimales (10 USDC => 10_000_000n)
// at: cuándo mintear para fijar su β (etiquetas que mapeamos en el script)

module.exports = [
  { seller: 'alice',    outcomeIndex: 1, amount: 100n, askUSDC_6dec: 10_000_000n, at: 'tOpen' },
  { seller: 'ruben',    outcomeIndex: 1, amount: 50n, askUSDC_6dec: 7_000_000n, at: 'tQuarter'},
  { seller: 'bob',      outcomeIndex: 1, amount: 90n,  askUSDC_6dec: 11_000_000n, at: 'tMid'  },
  { seller: 'deployer', outcomeIndex: 1, amount: 60n,  askUSDC_6dec:  8_500_000n, at: 'tLater'},
  { seller: 'albert',   outcomeIndex: 1, amount: 90n,  askUSDC_6dec: 11_000_000n, atOffsetSec: 120 },
  /*{ seller: 'davit',    outcomeIndex: 1, amount: 60n,  askUSDC_6dec:  8_500_000n, at: 'tLater'},*/


];
