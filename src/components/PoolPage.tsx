import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Contract, MaxUint256, formatUnits, parseUnits } from "ethers";
import { CheckInPill } from "./CheckInPill";
import {
  ERC20_ABI,
  PAIR_ABI,
  ROUTER_ABI,
  decodeWalletError,
  dexApi,
  explorerTx,
  fmtUnits,
  type PoolMeta,
  type TokensResp,
} from "@/lib/dex";
import { ensureGiwaNetwork, getProvider } from "@/lib/wallet";
import { useWallet } from "@/lib/wallet-context";
import { TokenIcon } from "./TokenIcon";
import { SuccessDialog } from "./SuccessDialog";

type UiToken = {
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
};

function buildUiTokens(t: TokensResp): UiToken[] {
  const bySymbol = new Map(t.tokens.map((x) => [x.symbol.toUpperCase(), x]));
  const wethMeta = bySymbol.get("WETH") ?? { address: t.weth, decimals: 18, symbol: "WETH" };
  const list: UiToken[] = [
    { address: wethMeta.address, symbol: "GIWA", decimals: 18, isNative: true },
  ];
  for (const sym of ["GDEX", "USDT", "USDC"]) {
    const m = bySymbol.get(sym);
    if (m) list.push({ address: m.address, symbol: sym, decimals: m.decimals, isNative: false });
  }
  return list;
}

const DEFAULT_SLIPPAGE = 0.5;

export function PoolPage() {
  const { address, refreshTick, bumpRefresh } = useWallet();
  const [tokens, setTokens] = useState<TokensResp | null>(null);
  const [uiTokens, setUiTokens] = useState<UiToken[]>([]);
  const [pools, setPools] = useState<PoolMeta[]>([]);

  useEffect(() => {
    dexApi
      .tokens()
      .then((t) => {
        setTokens(t);
        setUiTokens(buildUiTokens(t));
      })
      .catch((e) => {
        console.error("Failed to load tokens", e);
        toast.error(`Failed to load tokens: ${e?.message ?? e}`);
      });
  }, []);

  const refreshPools = useCallback(async () => {
    try {
      const res = address ? await dexApi.poolsFor(address) : await dexApi.pools();
      setPools(res.pools);
    } catch {
      setPools([]);
    }
  }, [address]);

  useEffect(() => {
    refreshPools();
  }, [refreshPools, refreshTick]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--primary)] sm:text-4xl">
          Liquidity Pools
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add liquidity or manage your positions on GIWA Sepolia.
        </p>
      </div>

      {tokens && uiTokens.length > 0 && (
        <AddLiquidityCard
          tokens={tokens}
          uiTokens={uiTokens}
          onComplete={() => {
            bumpRefresh();
            refreshPools();
          }}
        />
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Your positions</h2>
        {!address && (
          <div className="card-panel p-6 text-center text-sm text-muted-foreground">
            Connect your wallet to see your positions.
          </div>
        )}
        {address && pools.filter((p) => p.hasPosition).length === 0 && (
          <div className="card-panel p-6 text-center text-sm text-muted-foreground">
            You don't have any liquidity positions yet.
          </div>
        )}
        <div className="space-y-3">
          {tokens &&
            uiTokens.length > 0 &&
            pools
              .filter((p) => p.hasPosition)
              .map((p) => (
                <PositionCard
                  key={p.pairAddress}
                  pool={p}
                  tokens={tokens}
                  uiTokens={uiTokens}
                  onComplete={() => {
                    bumpRefresh();
                    refreshPools();
                  }}
                />
              ))}
        </div>
      </div>
    </div>
  );
}

function findUi(uiTokens: UiToken[], addr: string): UiToken | undefined {
  return uiTokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());
}

function AddLiquidityCard({
  tokens,
  uiTokens,
  onComplete,
  lockedPair,
}: {
  tokens: TokensResp;
  uiTokens: UiToken[];
  onComplete: () => void;
  lockedPair?: { a: UiToken; b: UiToken };
}) {
  const { address, onGiwa, connect } = useWallet();
  const [aIdx, setAIdx] = useState(0);
  const [bIdx, setBIdx] = useState(1);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [reserves, setReserves] = useState<{ resA: bigint; resB: bigint; exists: boolean } | null>(
    null,
  );
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [allowA, setAllowA] = useState<bigint>(0n);
  const [allowB, setAllowB] = useState<bigint>(0n);
  const [slippage] = useState(DEFAULT_SLIPPAGE);
  const [pending, setPending] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successData, setSuccessData] = useState<{ title: string; description?: string; hash?: string }>({ title: "" });

  const a = lockedPair?.a ?? uiTokens[aIdx];
  const b = lockedPair?.b ?? uiTokens[bIdx];

  // Load reserves + balances + allowances
  const refresh = useCallback(async () => {
    if (!a || !b || !tokens) return;
    try {
      const provider = await getProvider();
      // reserves via factory pair lookup - use pools API cheaper; but we only have local addresses.
      // We approximate via getAmountsOut? Simpler: call factory getPair via ROUTER_ABI's factory().
      // Use a small pair-fetch via factory contract.
      const factory = new Contract(
        tokens.factory,
        ["function getPair(address,address) view returns (address)"],
        provider,
      );
      const pairAddr: string = await factory.getPair(a.address, b.address);
      if (pairAddr && pairAddr !== "0x0000000000000000000000000000000000000000") {
        const pair = new Contract(pairAddr, PAIR_ABI, provider);
        const [r0, r1] = await pair.getReserves();
        const token0: string = await pair.token0();
        const aIsToken0 = token0.toLowerCase() === a.address.toLowerCase();
        setReserves({
          resA: aIsToken0 ? BigInt(r0) : BigInt(r1),
          resB: aIsToken0 ? BigInt(r1) : BigInt(r0),
          exists: true,
        });
      } else {
        setReserves({ resA: 0n, resB: 0n, exists: false });
      }
      // balances
      if (address) {
        const map: Record<string, bigint> = {};
        for (const t of [a, b]) {
          if (t.isNative) map[t.symbol] = await provider.getBalance(address);
          else {
            const c = new Contract(t.address, ERC20_ABI, provider);
            map[t.symbol] = await c.balanceOf(address);
          }
        }
        setBalances(map);
        // allowances
        const set = async (t: UiToken) => {
          if (t.isNative) return MaxUint256;
          const c = new Contract(t.address, ERC20_ABI, provider);
          return (await c.allowance(address, tokens.router)) as bigint;
        };
        setAllowA(await set(a));
        setAllowB(await set(b));
      }
    } catch {
      // ignore
    }
  }, [a, b, tokens, address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // auto-compute the other side based on ratio
  const updateAmountA = (v: string) => {
    setAmountA(v);
    if (reserves?.exists && reserves.resA > 0n && v && !isNaN(Number(v))) {
      try {
        const amt = parseUnits(v, a.decimals);
        const paired = (amt * reserves.resB) / reserves.resA;
        setAmountB(formatUnits(paired, b.decimals));
      } catch {}
    }
  };
  const updateAmountB = (v: string) => {
    setAmountB(v);
    if (reserves?.exists && reserves.resB > 0n && v && !isNaN(Number(v))) {
      try {
        const amt = parseUnits(v, b.decimals);
        const paired = (amt * reserves.resA) / reserves.resB;
        setAmountA(formatUnits(paired, a.decimals));
      } catch {}
    }
  };

  const needApprovalA = useMemo(() => {
    if (!a || a.isNative || !amountA) return false;
    try {
      return allowA < parseUnits(amountA, a.decimals);
    } catch {
      return false;
    }
  }, [a, amountA, allowA]);
  const needApprovalB = useMemo(() => {
    if (!b || b.isNative || !amountB) return false;
    try {
      return allowB < parseUnits(amountB, b.decimals);
    } catch {
      return false;
    }
  }, [b, amountB, allowB]);

  const doApprove = async (t: UiToken) => {
    setPending(`approve-${t.symbol}`);
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const c = new Contract(t.address, ERC20_ABI, signer);
      const tx = await c.approve(tokens.router, MaxUint256);
      toast.message(`Approving ${t.symbol}…`);
      const rc = await tx.wait();
      toast.success(`${t.symbol} approved`, {
        action: rc?.hash
          ? { label: "View", onClick: () => window.open(explorerTx(rc.hash), "_blank") }
          : undefined,
      });
      refresh();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  const doAdd = async () => {
    if (!a || !b || !address || !amountA || !amountB) return;
    setPending("add");
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const router = new Contract(tokens.router, ROUTER_ABI, signer);
      const amtA = parseUnits(amountA, a.decimals);
      const amtB = parseUnits(amountB, b.decimals);
      const minA = (amtA * BigInt(Math.round((100 - slippage) * 100))) / 10000n;
      const minB = (amtB * BigInt(Math.round((100 - slippage) * 100))) / 10000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      let tx;
      if (a.isNative) {
        tx = await router.addLiquidityETH(b.address, amtB, minB, minA, address, deadline, {
          value: amtA,
        });
      } else if (b.isNative) {
        tx = await router.addLiquidityETH(a.address, amtA, minA, minB, address, deadline, {
          value: amtB,
        });
      } else {
        tx = await router.addLiquidity(
          a.address,
          b.address,
          amtA,
          amtB,
          minA,
          minB,
          address,
          deadline,
        );
      }
      toast.message("Adding liquidity…", { description: "Waiting for confirmation." });
      const rc = await tx.wait();
      setSuccessData({
        title: "Liquidity added",
        description: `${a.symbol} + ${b.symbol} added to the pool.`,
        hash: rc?.hash,
      });
      setSuccessOpen(true);
      setAmountA("");
      setAmountB("");
      onComplete();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  const bal = (t?: UiToken) => (t ? balances[t.symbol] ?? 0n : 0n);

  return (
    <div className="card-panel p-5">
      <SuccessDialog
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        title={successData.title}
        description={successData.description}
        txHash={successData.hash}
        explorerUrl={successData.hash ? explorerTx(successData.hash) : undefined}
      />
      <div className="mb-3 text-sm font-semibold">Add liquidity</div>
      <SideRow
        label="Token A"
        tokens={uiTokens}
        selectedIdx={lockedPair ? -1 : aIdx}
        onSelect={(i) => {
          if (i === bIdx) setBIdx(aIdx);
          setAIdx(i);
          setAmountA("");
          setAmountB("");
        }}
        selected={a}
        amount={amountA}
        onAmount={updateAmountA}
        balance={bal(a)}
        locked={!!lockedPair}
      />
      <div className="my-2 text-center text-xs text-muted-foreground">+</div>
      <SideRow
        label="Token B"
        tokens={uiTokens}
        selectedIdx={lockedPair ? -1 : bIdx}
        onSelect={(i) => {
          if (i === aIdx) setAIdx(bIdx);
          setBIdx(i);
          setAmountA("");
          setAmountB("");
        }}
        selected={b}
        amount={amountB}
        onAmount={updateAmountB}
        balance={bal(b)}
        locked={!!lockedPair}
      />

      <div className="mt-3 text-xs text-muted-foreground">
        {reserves?.exists === false
          ? "This pair has no liquidity yet — you're the first LP. Set both amounts freely."
          : reserves?.exists
            ? "Amounts auto-balance to the current pool ratio."
            : "Loading pool…"}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {needApprovalA && (
          <button
            className="btn-outline text-sm"
            disabled={!!pending}
            onClick={() => doApprove(a)}
          >
            {pending === `approve-${a.symbol}` ? "Approving…" : `Approve ${a.symbol}`}
          </button>
        )}
        {needApprovalB && (
          <button
            className="btn-outline text-sm"
            disabled={!!pending}
            onClick={() => doApprove(b)}
          >
            {pending === `approve-${b.symbol}` ? "Approving…" : `Approve ${b.symbol}`}
          </button>
        )}
      </div>

      <button
        className="btn-primary mt-3 w-full"
        disabled={
          !!pending ||
          !amountA ||
          !amountB ||
          needApprovalA ||
          needApprovalB ||
          Number(amountA) <= 0 ||
          Number(amountB) <= 0
        }
        onClick={() => {
          if (!address) return connect();
          if (!onGiwa)
            return ensureGiwaNetwork().catch((e) => toast.error(decodeWalletError(e)));
          doAdd();
        }}
      >
        {!address
          ? "Connect Wallet"
          : !onGiwa
            ? "Switch to GIWA Testnet"
            : pending === "add"
              ? "Adding liquidity…"
              : "Add Liquidity"}
      </button>
    </div>
  );
}

function SideRow({
  label,
  tokens,
  selectedIdx,
  onSelect,
  selected,
  amount,
  onAmount,
  balance,
  locked,
}: {
  label: string;
  tokens: UiToken[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  selected: UiToken;
  amount: string;
  onAmount: (v: string) => void;
  balance: bigint;
  locked?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-[var(--muted)] p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          Balance:{" "}
          <span className="font-mono">
            {selected ? fmtUnits(balance, selected.decimals, 4) : "0"}
          </span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => onAmount(e.target.value.replace(/,/g, ""))}
          className="w-full bg-transparent text-2xl font-semibold outline-none"
        />
        {locked ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-sm font-semibold">
            <TokenIcon symbol={selected?.symbol} size={20} />
            {selected?.symbol}
          </span>
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-sm font-semibold">
            <TokenIcon symbol={selected?.symbol} size={20} />
            <select
              value={selectedIdx}
              onChange={(e) => onSelect(Number(e.target.value))}
              className="bg-transparent outline-none"
            >
              {tokens.map((tk, i) => (
                <option key={tk.symbol} value={i}>
                  {tk.symbol}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function PositionCard({
  pool,
  tokens,
  uiTokens,
  onComplete,
}: {
  pool: PoolMeta;
  tokens: TokensResp;
  uiTokens: UiToken[];
  onComplete: () => void;
}) {
  const { address, onGiwa } = useWallet();
  const [tab, setTab] = useState<"add" | "remove" | null>(null);
  const [pct, setPct] = useState(0);
  const [lpAllowance, setLpAllowance] = useState<bigint>(0n);
  const [pending, setPending] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successHash, setSuccessHash] = useState<string | undefined>();

  // Resolve tokens directly from pool row (never crash on missing lookup).
  const tA: UiToken = findUi(uiTokens, pool.tokenAAddress) ?? {
    address: pool.tokenAAddress,
    symbol: pool.tokenA,
    decimals: pool.tokenA === "USDC" || pool.tokenA === "USDT" ? 6 : 18,
    isNative: false,
  };
  const tB: UiToken = findUi(uiTokens, pool.tokenBAddress) ?? {
    address: pool.tokenBAddress,
    symbol: pool.tokenB,
    decimals: pool.tokenB === "USDC" || pool.tokenB === "USDT" ? 6 : 18,
    isNative: false,
  };

  // Compute user's underlying amounts robustly from bigints
  const lpBal = BigInt(pool.userLpBalance ?? "0");
  const lpTotal = BigInt(pool.lpTotalSupply ?? "0");
  const resA = BigInt(pool.reserveA ?? "0");
  const resB = BigInt(pool.reserveB ?? "0");
  const outA = lpTotal > 0n ? (lpBal * resA) / lpTotal : 0n;
  const outB = lpTotal > 0n ? (lpBal * resB) / lpTotal : 0n;
  const lpBurn = (lpBal * BigInt(Math.round(pct * 100))) / 10000n;
  const partOutA = (outA * BigInt(Math.round(pct * 100))) / 10000n;
  const partOutB = (outB * BigInt(Math.round(pct * 100))) / 10000n;

  const refreshAllow = useCallback(async () => {
    if (!address) return;
    try {
      const provider = await getProvider();
      const pair = new Contract(pool.pairAddress, PAIR_ABI, provider);
      setLpAllowance(await pair.allowance(address, tokens.router));
    } catch {}
  }, [address, pool.pairAddress, tokens.router]);

  useEffect(() => {
    if (tab === "remove") refreshAllow();
  }, [tab, refreshAllow]);

  const needLpApproval = lpAllowance < lpBurn && lpBurn > 0n;

  const approveLp = async () => {
    setPending("approve-lp");
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const pair = new Contract(pool.pairAddress, PAIR_ABI, signer);
      const tx = await pair.approve(tokens.router, MaxUint256);
      toast.message("Approving LP token…");
      await tx.wait();
      toast.message("LP token approved");
      refreshAllow();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  const doRemove = async () => {
    if (!address || lpBurn === 0n) return;
    setPending("remove");
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const router = new Contract(tokens.router, ROUTER_ABI, signer);
      const slip = BigInt(Math.round((100 - DEFAULT_SLIPPAGE) * 100));
      const minA = (partOutA * slip) / 10000n;
      const minB = (partOutB * slip) / 10000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      let tx;
      if (tA.isNative) {
        tx = await router.removeLiquidityETH(tB.address, lpBurn, minB, minA, address, deadline);
      } else if (tB.isNative) {
        tx = await router.removeLiquidityETH(tA.address, lpBurn, minA, minB, address, deadline);
      } else {
        tx = await router.removeLiquidity(
          tA.address,
          tB.address,
          lpBurn,
          minA,
          minB,
          address,
          deadline,
        );
      }
      toast.message("Removing liquidity…");
      const rc = await tx.wait();
      setSuccessHash(rc?.hash);
      setSuccessOpen(true);
      setPct(0);
      setTab(null);
      onComplete();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="card-panel p-4">
      <SuccessDialog
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        title="Liquidity removed"
        description={`Received ${tA.symbol} + ${tB.symbol}.`}
        txHash={successHash}
        explorerUrl={successHash ? explorerTx(successHash) : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex -space-x-1.5">
              <TokenIcon symbol={tA.symbol} size={22} className="ring-2 ring-white" />
              <TokenIcon symbol={tB.symbol} size={22} className="ring-2 ring-white" />
            </span>
            {tA.symbol} / {tB.symbol}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{fmtUnits(outA, tA.decimals, 4)}</span> {tA.symbol} +{" "}
            <span className="font-mono">{fmtUnits(outB, tB.decimals, 4)}</span> {tB.symbol} · Share{" "}
            {(pool.userSharePct ?? 0).toFixed(4)}%
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className={`text-xs rounded-full border px-3 py-1 ${tab === "add" ? "border-[var(--primary)] text-[var(--primary)]" : "border-border text-muted-foreground"}`}
            onClick={() => setTab(tab === "add" ? null : "add")}
          >
            Add more
          </button>
          <button
            className={`text-xs rounded-full border px-3 py-1 ${tab === "remove" ? "border-[var(--primary)] text-[var(--primary)]" : "border-border text-muted-foreground"}`}
            onClick={() => setTab(tab === "remove" ? null : "remove")}
          >
            Remove
          </button>
        </div>
      </div>

      {tab === "add" && (
        <div className="mt-3">
          <AddLiquidityCard
            tokens={tokens}
            uiTokens={uiTokens}
            onComplete={onComplete}
            lockedPair={{ a: tA, b: tB }}
          />
        </div>
      )}

      {tab === "remove" && (
        <div className="mt-3 rounded-lg border border-border bg-[var(--muted)] p-3">
          <div className="text-xs text-muted-foreground">
            Remove <span className="font-semibold">{pct}%</span> of your position
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            {[0, 25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setPct(p)} className="hover:text-foreground">
                {p}%
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs">
            You'll receive: <span className="font-mono">{fmtUnits(partOutA, tA.decimals, 4)}</span>{" "}
            {tA.symbol} +{" "}
            <span className="font-mono">{fmtUnits(partOutB, tB.decimals, 4)}</span> {tB.symbol}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {needLpApproval && (
              <button
                className="btn-outline text-sm"
                onClick={approveLp}
                disabled={!!pending}
              >
                {pending === "approve-lp" ? "Approving LP…" : "Approve LP Token"}
              </button>
            )}
            <button
              className="btn-primary text-sm"
              disabled={
                !!pending || pct === 0 || needLpApproval || !onGiwa
              }
              onClick={doRemove}
            >
              {pending === "remove" ? "Removing…" : "Remove Liquidity"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}