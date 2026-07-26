export const DEX_API_BASE = "https://giwa-api.test-hub.xyz";

export const GIWA_SEPOLIA_EXPLORER = "https://sepolia-explorer.giwa.io";

export type TokenMeta = {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
};

export type TokensResp = {
  tokens: TokenMeta[];
  router: string;
  factory: string;
  weth: string;
  checkIn: string;
  gdexToken: string;
};

export type PoolMeta = {
  address: string;
  token0: TokenMeta;
  token1: TokenMeta;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  exists: boolean;
  // when queried per user:
  userLpBalance?: string;
  userSharePct?: number;
  userToken0Amount?: string;
  userToken1Amount?: string;
  hasPosition?: boolean;
};

export type PoolsResp = { pools: PoolMeta[] };

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(`${DEX_API_BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export const dexApi = {
  tokens: async (): Promise<TokensResp> => {
    const raw = await jget<any>("/api/tokens");
    const t = raw?.tokens;
    const tokens: TokenMeta[] = Array.isArray(t)
      ? t
      : t && typeof t === "object"
        ? Object.entries(t).map(([symbol, info]: [string, any]) => ({
            symbol,
            address: info.address,
            name: info.name,
            decimals: Number(info.decimals),
          }))
        : [];
    return {
      tokens,
      router: raw.router,
      factory: raw.factory,
      weth: raw.weth ?? tokens.find((x) => x.symbol.toUpperCase() === "WETH")?.address ?? "",
      checkIn: raw.checkIn,
      gdexToken: raw.gdexToken,
    };
  },
  pools: () => jget<PoolsResp>("/api/pools"),
  poolsFor: (a: string) => jget<PoolsResp>(`/api/pools/${a}`),
};

// Standard Uniswap V2 ABI fragments
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

export const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function getAmountsIn(uint amountOut, address[] path) view returns (uint[] amounts)",
  "function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] path,address to,uint deadline) returns (uint[] amounts)",
  "function swapExactETHForTokens(uint amountOutMin,address[] path,address to,uint deadline) payable returns (uint[] amounts)",
  "function swapExactTokensForETH(uint amountIn,uint amountOutMin,address[] path,address to,uint deadline) returns (uint[] amounts)",
  "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)",
  "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken,uint amountETH,uint liquidity)",
  "function removeLiquidity(address tokenA,address tokenB,uint liquidity,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB)",
  "function removeLiquidityETH(address token,uint liquidity,uint amountTokenMin,uint amountETHMin,address to,uint deadline) returns (uint amountToken,uint amountETH)",
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
];

export const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

// Common check-in ABI (best-effort — most streak-reward contracts follow this shape)
export const CHECKIN_ABI = [
  "function checkIn()",
  "function canCheckIn(address) view returns (bool)",
  "function lastCheckIn(address) view returns (uint256)",
  "function streaks(address) view returns (uint256)",
  "function getReward(address) view returns (uint256)",
  "event CheckedIn(address indexed user, uint256 reward, uint256 streak)",
];

export function decodeWalletError(e: any): string {
  if (!e) return "Unknown error";
  const msg: string = e?.shortMessage ?? e?.message ?? "";
  if (e.code === 4001 || /user rejected|user denied/i.test(msg))
    return "You rejected the request in your wallet.";
  if (/insufficient funds/i.test(msg)) return "Insufficient funds for gas.";
  if (/insufficient.*allowance/i.test(msg))
    return "Not enough allowance — approve the token first.";
  if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage/i.test(msg))
    return "Slippage exceeded. Try again or raise slippage tolerance.";
  if (/EXPIRED|deadline/i.test(msg))
    return "Transaction deadline expired. Try again.";
  if (/INSUFFICIENT_LIQUIDITY/i.test(msg))
    return "Not enough liquidity in this pool for that trade size.";
  if (/network|timeout|failed to fetch/i.test(msg))
    return "Network / RPC error. Check your connection and retry.";
  return msg || "Something went wrong";
}

export function explorerTx(hash: string) {
  return `${GIWA_SEPOLIA_EXPLORER}/tx/${hash}`;
}

// Format a bigint as human-readable using decimals, up to `maxFrac` digits.
export function fmtUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  if (frac === 0n) return (neg ? "-" : "") + whole.toString();
  let f = frac.toString().padStart(decimals, "0");
  f = f.slice(0, maxFrac).replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (f ? "." + f : "");
}