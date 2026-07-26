# GIWA DEX
<img width="1902" height="787" alt="image" src="https://github.com/user-attachments/assets/fe3c2ef1-90e3-4314-8aae-c0d574185e67" />

A full decentralized exchange stack built for the **GIWA Sepolia testnet** : deploy your own DEX, swap tokens, provide liquidity, and earn daily rewards through an on-chain check-in system.

Live at **[giwa.test-hub.xyz](https://giwa.test-hub.xyz)**

---

## What's in here

This repo covers the entire GIWA DEX product:

- **DEX Deployer** (`/`) : a 4-step flow (Connect Wallet → Get Sepolia ETH → Bridge to GIWA → Deploy) that lets anyone deploy their own WETH + Factory + Router set on GIWA Sepolia, fully non-custodial and signed by the user's own wallet.
- **Swap** (`/swap`) : token swap UI for the GIWA DEX instance, with a 0–100% balance slider, live quotes, and slippage control.
- **Pool** (`/pool`) : add/remove liquidity across all known trading pairs, including per-pair "Manage" controls with an LP-burn slider for partial withdrawals.
- **Daily Check-in** : an on-chain rewards system: check in once a day to earn GDEX, with a streak counter and a bonus for 7-day streaks.
- **Backend API** : a stateless, read-only FastAPI service that serves contract ABIs/bytecode for deployment, live pool reserves, and per-wallet LP balances. It never touches a private key or signs a transaction : every write action happens client-side, signed by the user's own wallet.
- **Smart contracts** : WETH, Factory, Router (Uniswap V2-style), the GDEX token, the check-in/rewards contract, and mock USDT/USDC test tokens.

## Network

| | |
|---|---|
| Chain name | GIWA Sepolia Testnet |
| Chain ID | `91342` (`0x1652E`) |
| RPC URL | `https://sepolia-rpc.giwa.io` |
| Block explorer | `https://sepolia-explorer.giwa.io` |
| Native currency | ETH |

## Deployed contracts
<img width="757" height="746" alt="image" src="https://github.com/user-attachments/assets/13d92bb1-1960-47fd-909e-fdc1d4fb3b0d" />

| Contract | Address |
|---|---|
| WETH | `0xE13cb123bb620203791371593c992343A3EE6C7F` |
| Factory | `0x9992053d3F24B4a67542bdF74A1cA4D8422f9206` |
| Router | `0x070bd877F573Ea66E24c140876E07558b970B404` |
| GDEX (GIWA DEX Token) | `0x02b8b8090dFFb61dE134A9e639577E9c153Ac871` |
| GDEXCheckIn | `0xa1b4Db18Fe0903e407FFeD9A7f3CA8B7FfaC052D` |
| Mock USDT | `0x2bb801d90A99b5619D5361ED7a75398FB3b0Cb22` |
| Mock USDC | `0xd7E5A73D66D202CD211290536eab5096E8a5114F` |

Factory/Router are a standard Uniswap V2-style fork. Mock USDT/USDC are 6-decimal fixed-supply ERC-20 test tokens (100M supply each) : not real stablecoins, testnet only. GDEX has a fixed supply of 100,000,000,000 (100B), minted entirely to the deployer at construction.

### Known trading pairs

| Pair | Notes |
|---|---|
| USDT / USDC | |
| WETH(GIWA) / USDC | |
| WETH(GIWA) / USDT | |
| WETH(GIWA) / GDEX | |
<img width="1008" height="638" alt="image" src="https://github.com/user-attachments/assets/aa5e6c38-6ed8-47fb-a104-cc2d93bc8687" />

The frontend displays WETH as **"GIWA"** everywhere : swapping "GIWA" uses the native-ETH Router functions (`swapExactETHForTokens`, `addLiquidityETH`, etc.) so users trade native testnet ETH directly rather than pre-wrapped WETH.

## Daily Check-in
<img width="272" height="46" alt="image" src="https://github.com/user-attachments/assets/10cd542f-d355-4d4c-9d43-90c0b65f0848" />

- **Reward:** 100 GDEX per check-in.
- **Reset:** UTC midnight, which is 5:30 AM IST.
- **Streak:** consecutive daily check-ins are tracked; missing a day resets the streak to 0.
- **Bonus:** an additional 10,000 GDEX on reaching a 7-day streak.
- The check-in contract is pre-funded with 25% of the total GDEX supply (25,000,000,000 GDEX) to cover reward distribution.

## Architecture

```
┌───────────────────┐      read-only calls       ┌───────────────────────┐
│   Frontend         │ ─────────────────────────▶ │  Backend (FastAPI)     │
│   (React/Vite)     │                             │  PM2-managed           │
│                     │ ◀───────────────────────── │  Caddy reverse proxy   │
└──────────┬──────────┘      token/pool data       └───────────────────────┘
           │
           │ signed transactions (wallet-only)
           ▼
┌────────────────────────────────────────────────┐
│         GIWA Sepolia Testnet (chain 91342)       │
│  WETH · Factory · Router · GDEX · CheckIn ·      │
│  Mock USDT · Mock USDC                            │
└────────────────────────────────────────────────┘
```

The backend **never holds or uses a private key**. Its only jobs are:
1. Serving compiled ABI + bytecode for WETH/Factory/Router so the frontend can deploy them via the connecting wallet.
2. Reading a wallet's GIWA testnet ETH balance (read-only RPC call).
3. Recording/serving deployment history by wallet address.
4. Reading live pool reserves and per-wallet LP balances so the frontend doesn't need to hardcode ABI calls or track pair addresses itself.

Every write action : deploy, swap, approve, add/remove liquidity, check-in : is constructed client-side and signed entirely by the user's own connected wallet (MetaMask).
<img width="878" height="671" alt="image" src="https://github.com/user-attachments/assets/df71646c-a8cd-48ec-86ac-65b588397858" />

## Backend API

Base URL: `https://giwa-api.test-hub.xyz`

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/deploy-info` | GET | ABI + bytecode for WETH/Factory/Router, plus network info, for the Deployer flow |
| `/api/balance/{address}` | GET | Wallet's native ETH balance on GIWA testnet |
| `/api/faucets` | GET | List of Sepolia and GIWA-specific faucets/bridges |
| `/api/deployments` | POST | Record a completed DEX deployment |
| `/api/deployments/{address}` | GET | Deployment history for a wallet |
| `/api/tokens` | GET | Fixed token list (WETH, GDEX, USDT, USDC) with addresses/decimals, plus router/factory/checkIn addresses |
| `/api/pools` | GET | All known pairs with live on-chain reserves |
| `/api/pools/{address}` | GET | Same as above, plus a wallet's LP balance, pool share %, and underlying token amounts per pair |

## Tech stack

- **Frontend:** React + Vite, ethers.js (v6), deployed on Vercel
- **Backend:** FastAPI (Python), SQLite for deployment history, PM2-managed, served via Caddy reverse proxy
- **Contracts:** Solidity ^0.8.20, Hardhat, deployed to GIWA Sepolia
- **Wallet:** MetaMask / any EIP-1193 provider

## Running the backend locally

```bash
cd giwa-backend-api/app
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Deploying contracts

Contracts are deployed via Hardhat scripts against the `giwa` network:

```bash
npx hardhat run scripts/deploy-gdex.js --network giwa
npx hardhat run scripts/deploy-dex-tokens-and-lp.js --network giwa
```

`hardhat.config.js` targets GIWA Sepolia (chain ID `91342`, RPC `https://sepolia-rpc.giwa.io`), with a `PRIVATE_KEY` read from `.env`.

## Security notes

- No private keys are ever stored or transmitted to the backend : all signing happens client-side.
- The backend is fully stateless with respect to funds; it only reads public chain state and serves static ABI/bytecode.
- All contracts here are **testnet-only** : GDEX, mock USDT, and mock USDC have no real-world value and are not audited for mainnet use.

## Other projects

- [litdex.test-hub.xyz](https://litdex.test-hub.xyz) : DEX on LiteForge/LitVM
- [bob.test-hub.xyz](https://zkbet.test-hub.xyz) : BetsOnBlock, a provably fair blockchain betting game
- [quipstats.vercel.app](https://quipstats.test-hub.xyz) : live Quip Network dashboard
- [republicstats.xyz](https://republicstats.xyz) : Republic AI testnet dashboard

## Support

If this project is useful to you, consider donating via the **[♥ Donate](https://giwa.test-hub.xyz/)** button on the live site.

## License

MIT
