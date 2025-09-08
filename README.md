# Zone + Seaport PoC

This PoC shows in a **simple way** how a secondary market trade would work using **Seaport**, a custom **Zone**, and our ERC‑1155 contract.

---

## 🎯 Goal

Prove that the **Zone** can:

1. Check that the `tokenId` belongs to our ERC‑1155 market contract.
2. Make sure the VM (virtual market) is marked as `tradable`.
3. Check that required fee recipients appear in `consideration[]`.

---

## 🧩 Components

- **MockERC1155Market**: ERC‑1155 contract that simulates a market with `vmId`s and a flag to allow trading.
- **ZoneMinimal**: contract that validates an order before Seaport executes it.
- **MockSeaport**: simplified Seaport that calls the Zone for validation, then transfers tokens.
- **MockUSDC**: ERC‑20 stablecoin mock (not yet used in flows but ready if needed).
- **Tests (`zone-poc.test.js`)**: verify success and failure cases.

---

## 🔄 Flow

1. Seller (offerer) holds a `tokenId` in the `MockERC1155Market`.
2. The related `vmId` is marked as `tradable`.
3. An **Order** is created with:
   - Who sells (`offerer`)
   - What is sold (`token`, `tokenId`, `amount`)
   - Market (`vmId`)
   - Zone that validates (`ZoneMinimal`)
   - Required fees (`consideration[]`)
4. Buyer calls `MockSeaport.fulfillOrder`.
5. Seaport asks the Zone to validate the order.
6. If validation passes:
   - ERC‑1155 tokens move from seller to buyer.
   - Event `OrderFulfilled` is emitted.
7. If validation fails, the transaction reverts with a clear reason (e.g. `VM not tradable`, `missing required recipient`).

---

## 📂 Project structure

```
contracts/
  mocks/
    MockUSDC.sol
    MockERC1155Market.sol
    MockSeaport.sol
  ZoneMinimal.sol

test/
  zone-poc.test.js

scripts/
  deploy.js

hardhat.config.js
package.json
.gitignore
```

---

## 🚀 Run it

1. Install dependencies:

```bash
npm install
```

2. Compile:

```bash
npx hardhat compile
```

3. Run tests:

```bash
npx hardhat test
```

4. Deploy locally:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

---

## 📌 Notes

- The code is **mocked**: this is not a full Seaport implementation, only a clear demo.
- `scripts/deploy.js` will be included to deploy contracts and run a simple demo flow on localhost.
- `ZoneMinimal` can be extended (e.g., enforce minimum protocol fee %).

---

## ✅ Current state

- Basic PoC ready.
- Tests cover success and failure.
- Ready to extend with more realistic fee logic or lifecycle checks.
