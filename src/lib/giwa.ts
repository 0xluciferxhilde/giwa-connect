export const API_BASE = "https://giwa-api.test-hub.xyz";

export const GIWA_CHAIN = {
  chainId: 91342,
  chainIdHex: "0x164ce",
  chainName: "GIWA Sepolia Testnet",
  rpcUrls: ["https://sepolia-rpc.giwa.io"],
  blockExplorerUrls: ["https://sepolia-explorer.giwa.io"],
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
};

export const EXPLORER = "https://sepolia-explorer.giwa.io";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

export type TokenInfo = {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
};

export type TokensResp = {
  tokens: TokenInfo[];
  router: string;
  factory: string;
  checkIn: string;
  gdexToken: string;
};

export type PoolInfo = {
  address: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  exists: boolean;
};

export type PoolsResp = { pools: PoolInfo[] };

export type UserPoolInfo = PoolInfo & {
  hasPosition: boolean;
  userLpBalance: string;
  userSharePct: number;
  userTokenAAmount: string;
  userTokenBAmount: string;
};

export type UserPoolsResp = { pools: UserPoolInfo[] };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  tokens: () => get<TokensResp>("/api/tokens"),
  pools: () => get<PoolsResp>("/api/pools"),
  userPools: (addr: string) => get<UserPoolsResp>(`/api/pools/${addr}`),
};

// Fallback contract addresses (also returned by /api/tokens)
export const CONTRACTS = {
  WETH: "0xE13cb123bb620203791371593c992343A3EE6C7F",
  Factory: "0x9992053d3F24B4a67542bdF74A1cA4D8422f9206",
  Router: "0x070bd877F573Ea66E24c140876E07558b970B404",
  GDEX: "0x02b8b8090dFFb61dE134A9e639577E9c153Ac871",
  USDT: "0x2bb801d90A99b5619D5361ED7a75398FB3b0Cb22",
  USDC: "0xd7E5A73D66D202CD211290536eab5096E8a5114F",
  CheckIn: "0xa1b4Db18Fe0903e407FFeD9A7f3CA8B7FfaC052D",
} as const;

export const FALLBACK_TOKENS: TokenInfo[] = [
  { address: CONTRACTS.WETH, symbol: "GIWA", name: "GIWA (WETH)", decimals: 18 },
  { address: CONTRACTS.GDEX, symbol: "GDEX", name: "GDEX", decimals: 18 },
  { address: CONTRACTS.USDT, symbol: "USDT", name: "Tether USD", decimals: 6 },
  { address: CONTRACTS.USDC, symbol: "USDC", name: "USD Coin", decimals: 6 },
];
