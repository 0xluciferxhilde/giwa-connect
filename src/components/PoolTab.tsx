import { useEffect, useMemo, useState } from "react";
import { Contract, parseUnits, formatUnits, MaxUint256 } from "ethers";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useTokens, useBalances, useUserPools, usePools } from "@/hooks/useDex";
import { ERC20_ABI, ROUTER_ABI, PAIR_ABI } from "@/lib/abis";
import { runTx } from "@/lib/tx";
import type { TokenInfo, UserPoolInfo } from "@/lib/giwa";
import { TokenSelect } from "./TokenSelect";

export function PoolTab() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <AddLiquidityCard />
      <YourPositions />
    </div>
  );
}

function AddLiquidityCard({ presetA, presetB }: { presetA?: TokenInfo; presetB?: TokenInfo }) {
  const { address, provider, getSigner, connect, isCorrectChain, switchNetwork, bumpRefresh } =
    useWallet();
  const { data: cfg } = useTokens();
  const tokens = cfg?.tokens;
  const { data: bals } = useBalances(tokens);
  const { data: poolsData } = usePools();

  const [a, setA] = useState<TokenInfo | null>(null);
  const [b, setB] = useState<TokenInfo | null>(null);
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowA, setAllowA] = useState<bigint>(0n);
  const [allowB, setAllowB] = useState<bigint>(0n);

  useEffect(() => {
    if (!tokens) return;
    if (!a) setA(presetA ?? tokens.find((t) => t.symbol === "GIWA") ?? tokens[0]);
    if (!b) setB(presetB ?? tokens.find((t) => t.symbol === "GDEX") ?? tokens[1]);
  }, [tokens, presetA, presetB, a, b]);

  const pool = useMemo(() => {
    if (!a || !b || !poolsData) return null;
    return poolsData.pools.find(
      (p) =>
        (p.token0.toLowerCase() === a.address.toLowerCase() &&
          p.token1.toLowerCase() === b.address.toLowerCase()) ||
        (p.token0.toLowerCase() === b.address.toLowerCase() &&
          p.token1.toLowerCase() === a.address.toLowerCase()),
    );
  }, [a, b, poolsData]);

  const poolExists = !!pool?.exists;

  // auto-pair
  const updateFromA = (v: string) => {
    setAmtA(v);
    if (!poolExists || !pool || !a || !b || !v) {
      if (!poolExists) return;
      setAmtB("");
      return;
    }
    const r0 = Number(formatUnits(pool.reserve0, tokenDecimals(pool.token0, tokens)));
    const r1 = Number(formatUnits(pool.reserve1, tokenDecimals(pool.token1, tokens)));
    const aIsToken0 = pool.token0.toLowerCase() === a.address.toLowerCase();
    const rA = aIsToken0 ? r0 : r1;
    const rB = aIsToken0 ? r1 : r0;
    if (!rA) return;
    setAmtB(String(Number(((Number(v) * rB) / rA).toFixed(b.decimals))));
  };
  const updateFromB = (v: string) => {
    setAmtB(v);
    if (!poolExists || !pool || !a || !b || !v) {
      if (!poolExists) return;
      setAmtA("");
      return;
    }
    const r0 = Number(formatUnits(pool.reserve0, tokenDecimals(pool.token0, tokens)));
    const r1 = Number(formatUnits(pool.reserve1, tokenDecimals(pool.token1, tokens)));
    const aIsToken0 = pool.token0.toLowerCase() === a.address.toLowerCase();
    const rA = aIsToken0 ? r0 : r1;
    const rB = aIsToken0 ? r1 : r0;
    if (!rB) return;
    setAmtA(String(Number(((Number(v) * rA) / rB).toFixed(a.decimals))));
  };

  useEffect(() => {
    if (!address || !provider || !cfg || !a || !b) return;
    (async () => {
      const check = async (t: TokenInfo, setter: (b: bigint) => void) => {
        if (t.symbol === "GIWA") return setter(MaxUint256);
        try {
          const c = new Contract(t.address, ERC20_ABI, provider);
          setter(await c.allowance(address, cfg.router));
        } catch {
          setter(0n);
        }
      };
      check(a, setAllowA);
      check(b, setAllowB);
    })();
  }, [address, provider, cfg, a, b]);

  if (!a || !b || !tokens) return null;
  const balA = bals?.[a.symbol] ?? "0";
  const balB = bals?.[b.symbol] ?? "0";

  const needsA = a.symbol !== "GIWA" && amtA && safeParse(amtA, a.decimals) > allowA;
  const needsB = b.symbol !== "GIWA" && amtB && safeParse(amtB, b.decimals) > allowB;

  const insufficient =
    (amtA && Number(amtA) > Number(balA)) || (amtB && Number(amtB) > Number(balB));

  const buttonLabel = !address
    ? "Connect Wallet"
    : !isCorrectChain
      ? "Switch Network"
      : !amtA || !amtB || Number(amtA) <= 0 || Number(amtB) <= 0
        ? "Enter amounts"
        : insufficient
          ? "Insufficient balance"
          : needsA
            ? `Approve ${a.symbol}`
            : needsB
              ? `Approve ${b.symbol}`
              : "Add Liquidity";

  const handleClick = async () => {
    if (!address) return connect();
    if (!isCorrectChain) return switchNetwork();
    if (!cfg) return;
    setBusy(true);
    try {
      const signer = await getSigner();
      if (needsA) {
        const c = new Contract(a.address, ERC20_ABI, signer);
        const h = await runTx(`Approve ${a.symbol}`, () => c.approve(cfg.router, MaxUint256));
        if (h) setAllowA(MaxUint256);
        return;
      }
      if (needsB) {
        const c = new Contract(b.address, ERC20_ABI, signer);
        const h = await runTx(`Approve ${b.symbol}`, () => c.approve(cfg.router, MaxUint256));
        if (h) setAllowB(MaxUint256);
        return;
      }
      const router = new Contract(cfg.router, ROUTER_ABI, signer);
      const amountA = parseUnits(amtA, a.decimals);
      const amountB = parseUnits(amtB, b.decimals);
      const slippage = 0.005;
      const minA = (amountA * BigInt(Math.floor((1 - slippage) * 1000))) / 1000n;
      const minB = (amountB * BigInt(Math.floor((1 - slippage) * 1000))) / 1000n;
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

      let fn: () => Promise<any>;
      if (a.symbol === "GIWA") {
        fn = () =>
          router.addLiquidityETH(b.address, amountB, minB, minA, address, deadline, {
            value: amountA,
          });
      } else if (b.symbol === "GIWA") {
        fn = () =>
          router.addLiquidityETH(a.address, amountA, minA, minB, address, deadline, {
            value: amountB,
          });
      } else {
        fn = () =>
          router.addLiquidity(
            a.address,
            b.address,
            amountA,
            amountB,
            minA,
            minB,
            address,
            deadline,
          );
      }
      const h = await runTx("Add liquidity", fn);
      if (h) {
        setAmtA("");
        setAmtB("");
        bumpRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-panel p-4">
      <h2 className="mb-3 text-lg font-semibold">Add Liquidity</h2>
      <PoolInputBox
        token={a}
        amount={amtA}
        onAmount={updateFromA}
        balance={balA}
        tokens={tokens}
        onToken={setA}
        disabledSymbol={b.symbol}
      />
      <div className="my-2 text-center text-muted-foreground">+</div>
      <PoolInputBox
        token={b}
        amount={amtB}
        onAmount={updateFromB}
        balance={balB}
        tokens={tokens}
        onToken={setB}
        disabledSymbol={a.symbol}
      />
      {!poolExists && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          First liquidity provider — you set the initial price.
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function safeParse(v: string, d: number): bigint {
  try {
    return parseUnits(v, d);
  } catch {
    return 0n;
  }
}

function tokenDecimals(addr: string, tokens?: TokenInfo[]) {
  return tokens?.find((t) => t.address.toLowerCase() === addr.toLowerCase())?.decimals ?? 18;
}

function PoolInputBox({
  token,
  amount,
  onAmount,
  balance,
  tokens,
  onToken,
  disabledSymbol,
}: {
  token: TokenInfo;
  amount: string;
  onAmount: (v: string) => void;
  balance: string;
  tokens: TokenInfo[];
  onToken: (t: TokenInfo) => void;
  disabledSymbol?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>Balance: {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
        <button
          onClick={() => onAmount(balance)}
          className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
        >
          MAX
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          placeholder="0.0"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          className="flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/40"
        />
        <TokenSelect
          value={token}
          tokens={tokens}
          onChange={onToken}
          disabledSymbol={disabledSymbol}
        />
      </div>
    </div>
  );
}

function YourPositions() {
  const { address, isCorrectChain, connect } = useWallet();
  const { data } = useUserPools();
  const { data: cfg } = useTokens();

  if (!address) {
    return (
      <div className="card-panel p-6 text-center text-sm text-muted-foreground">
        <p>Connect your wallet to see your positions.</p>
        <button
          onClick={connect}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Connect Wallet
        </button>
      </div>
    );
  }
  if (!isCorrectChain) return null;
  const positions = (data?.pools ?? []).filter((p) => p.hasPosition);
  if (!positions.length) {
    return (
      <div className="card-panel p-6 text-center text-sm text-muted-foreground">
        You don't have any liquidity positions yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Your Positions
      </h3>
      {positions.map((p) => (
        <PositionCard key={p.address} pool={p} tokens={cfg?.tokens} />
      ))}
    </div>
  );
}

function PositionCard({ pool, tokens }: { pool: UserPoolInfo; tokens?: TokenInfo[] }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"add" | "remove">("remove");
  const tokenA = tokens?.find((t) => t.address.toLowerCase() === pool.token0.toLowerCase());
  const tokenB = tokens?.find((t) => t.address.toLowerCase() === pool.token1.toLowerCase());
  const symA = tokenA?.symbol === "WETH" ? "GIWA" : tokenA?.symbol ?? pool.token0Symbol;
  const symB = tokenB?.symbol === "WETH" ? "GIWA" : tokenB?.symbol ?? pool.token1Symbol;

  return (
    <div className="card-panel p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-[10px] font-bold text-primary-foreground ring-2 ring-card">
              {symA.slice(0, 2)}
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-accent to-primary text-[10px] font-bold text-primary-foreground ring-2 ring-card">
              {symB.slice(0, 2)}
            </span>
          </div>
          <div className="text-left">
            <div className="font-semibold">
              {symA} / {symB}
            </div>
            <div className="text-xs text-muted-foreground">
              {pool.userSharePct.toFixed(4)}% pool share
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs">
            <div>
              {Number(pool.userTokenAAmount).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {symA}
            </div>
            <div>
              {Number(pool.userTokenBAmount).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              {symB}
            </div>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && tokenA && tokenB && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(["remove", "add"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSub(s)}
                className={`flex-1 rounded-md px-3 py-1.5 capitalize ${sub === s ? "bg-background font-semibold" : "text-muted-foreground"}`}
              >
                {s === "add" ? "Add more" : "Remove"}
              </button>
            ))}
          </div>
          {sub === "add" ? (
            <AddLiquidityCard presetA={tokenA} presetB={tokenB} />
          ) : (
            <RemoveLiquidity pool={pool} tokenA={tokenA} tokenB={tokenB} symA={symA} symB={symB} />
          )}
        </div>
      )}
    </div>
  );
}

function RemoveLiquidity({
  pool,
  tokenA,
  tokenB,
  symA,
  symB,
}: {
  pool: UserPoolInfo;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  symA: string;
  symB: string;
}) {
  const { address, provider, getSigner, isCorrectChain, bumpRefresh } = useWallet();
  const { data: cfg } = useTokens();
  const [pct, setPct] = useState(50);
  const [allow, setAllow] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);

  const lpAmount = useMemo(() => {
    const lp = BigInt(pool.userLpBalance);
    return (lp * BigInt(pct)) / 100n;
  }, [pool.userLpBalance, pct]);

  const amtA = (Number(pool.userTokenAAmount) * pct) / 100;
  const amtB = (Number(pool.userTokenBAmount) * pct) / 100;

  useEffect(() => {
    if (!address || !provider || !cfg) return;
    (async () => {
      try {
        const c = new Contract(pool.address, PAIR_ABI, provider);
        setAllow(await c.allowance(address, cfg.router));
      } catch {}
    })();
  }, [address, provider, cfg, pool.address]);

  const needsApproval = lpAmount > 0n && lpAmount > allow;

  const handle = async () => {
    if (!address || !cfg || !isCorrectChain) return;
    setBusy(true);
    try {
      const signer = await getSigner();
      if (needsApproval) {
        const c = new Contract(pool.address, PAIR_ABI, signer);
        const h = await runTx("Approve LP", () => c.approve(cfg.router, MaxUint256));
        if (h) setAllow(MaxUint256);
        return;
      }
      const router = new Contract(cfg.router, ROUTER_ABI, signer);
      const slip = 0.005;
      const minA = parseUnits((amtA * (1 - slip)).toFixed(tokenA.decimals), tokenA.decimals);
      const minB = parseUnits((amtB * (1 - slip)).toFixed(tokenB.decimals), tokenB.decimals);
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
      let fn: () => Promise<any>;
      if (symA === "GIWA") {
        fn = () =>
          router.removeLiquidityETH(tokenB.address, lpAmount, minB, minA, address, deadline);
      } else if (symB === "GIWA") {
        fn = () =>
          router.removeLiquidityETH(tokenA.address, lpAmount, minA, minB, address, deadline);
      } else {
        fn = () =>
          router.removeLiquidity(
            tokenA.address,
            tokenB.address,
            lpAmount,
            minA,
            minB,
            address,
            deadline,
          );
      }
      const h = await runTx("Remove liquidity", fn);
      if (h) bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Amount to remove</span>
        <span className="text-2xl font-bold">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {[0, 25, 50, 75, 100].map((p) => (
          <button key={p} onClick={() => setPct(p)} className="hover:text-foreground">
            {p}%
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-1 rounded-lg bg-muted p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{symA}</span>
          <span className="font-mono">
            {amtA.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{symB}</span>
          <span className="font-mono">
            {amtB.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
        </div>
      </div>
      <button
        onClick={handle}
        disabled={busy || pct === 0}
        className="mt-3 w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
      >
        {needsApproval ? "Approve LP Token" : pct === 0 ? "Select amount" : "Remove Liquidity"}
      </button>
    </div>
  );
}