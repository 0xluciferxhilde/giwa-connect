export const API_BASE = "https://giwa-api.test-hub.xyz";

export const GIWA_CHAIN = {
  chainId: 91342,
  chainIdHex: "0x164ce",
  chainName: "GIWA Testnet",
  rpcUrls: ["https://sepolia-rpc.giwa.io"],
  blockExplorerUrls: ["https://sepolia-explorer.giwa.io"],
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
};

export type FaucetsResp = {
  sepoliaFaucets: { name: string; url: string }[];
  giwaFaucet: { name: string; url: string };
  giwaBridge: { name: string; url: string };
};

export type BalanceResp = {
  address: string;
  balanceWei: string;
  balanceEth: number;
  hasFunds: boolean;
};

export type PoolNameResp = { name: string; symbol: string };

export type DeployInfoResp = {
  network: {
    chainId: number;
    chainIdHex: string;
    rpcUrl: string;
    explorerUrl: string;
    currencySymbol: string;
  };
  dexName: string;
  dexSymbol: string;
  weth: { abi: any[]; bytecode: string };
  factory: { abi: any[]; bytecode: string };
  router: { abi: any[]; bytecode: string };
  factoryConstructorArgsNote?: string;
  routerConstructorArgsNote?: string;
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  faucets: () => get<FaucetsResp>("/api/faucets"),
  balance: (a: string) => get<BalanceResp>(`/api/balance/${a}`),
  poolName: () => get<PoolNameResp>("/api/pool-name"),
  deployInfo: (name: string, symbol: string) =>
    get<DeployInfoResp>(
      `/api/deploy-info?dex_name=${encodeURIComponent(name)}&dex_symbol=${encodeURIComponent(symbol)}`,
    ),
};

export const EXPLORER = "https://sepolia-explorer.giwa.io";
