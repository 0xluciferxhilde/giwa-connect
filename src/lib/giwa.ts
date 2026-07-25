export const API_BASE = "https://giwa-api.test-hub.xyz";

export const GIWA_CHAIN = {
  chainId: 91342,
  chainIdHex: "0x164ce",
  chainName: "GIWA Testnet",
  rpcUrls: ["https://sepolia-rpc.giwa.io"],
  blockExplorerUrls: ["https://sepolia-explorer.giwa.io"],
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
};

export const BASE_CHAIN = {
  chainId: 8453,
  chainIdHex: "0x2105",
  chainName: "Base",
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
};

// Official Base mainnet USDC
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_USDC_DECIMALS = 6;

export const DONATION_ADDRESS = "0x3bc6348e1e569e97bd8247b093475a4ac22b9fd4";

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
};

export type DeploymentRecord = {
  id: number;
  deployerAddress: string;
  dexName: string;
  dexSymbol: string;
  wethAddress: string;
  factoryAddress: string;
  routerAddress: string;
  wethTxHash?: string;
  factoryTxHash?: string;
  routerTxHash?: string;
  chainId: number;
  createdAt: number;
  explorerLinks: { weth: string; factory: string; router: string };
};

export type DeploymentsListResp = {
  address: string;
  count: number;
  deployments: DeploymentRecord[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
  return r.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  listDeployments: (a: string) => get<DeploymentsListResp>(`/api/deployments/${a}`),
  saveDeployment: (body: {
    deployerAddress: string;
    dexName: string;
    dexSymbol: string;
    wethAddress: string;
    factoryAddress: string;
    routerAddress: string;
    wethTxHash?: string;
    factoryTxHash?: string;
    routerTxHash?: string;
  }) => post<DeploymentRecord>("/api/deployments", body),
};

export const EXPLORER = "https://sepolia-explorer.giwa.io";
