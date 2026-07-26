import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Contract, MaxUint256, formatUnits, parseUnits } from "ethers";
import { Navbar } from "./Navbar";
import { CheckInPill } from "./CheckInPill";
import {
  ERC20_ABI,
  ROUTER_ABI,
  decodeWalletError,
  dexApi,
  explorerTx,
  fmtUnits,
  type TokensResp,
} from "@/lib/dex";
import { ensureGiwaNetwork, getProvider } from "@/lib/wallet";
import { useWallet } from "@/lib/wallet-context";
import { TokenIcon } from "./TokenIcon";
import { SuccessDialog } from "./SuccessDialog";

type UiToken = {
  address: string; // for GIWA (native), this is the WETH address (used for swap path)
  symbol: string; // "GIWA" | "GDEX" | "USDT" | "USDC"
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
const NATIVE_GAS_BUFFER = parseUnits("0.0005", 18);

export function SwapPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Navbar active="swap" rightExtras={<CheckInPillMount />} />
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--primary)] sm:text-4xl">
          Swap
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trade on GIWA Sepolia testnet. Signed by your wallet.
        </p>
      </div>
      <SwapCard />
    </div>
  );
}

function CheckInPillMount() {
  const [tokens, setTokens] = useState<TokensResp | null>(null);
  useEffect(() => {
    let alive = true;
    dexApi.tokens().then((t) => alive && setTokens(t)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return <CheckInPill checkInAddress={tokens?.checkIn} />;
}

function SwapCard() {
  const { address, onGiwa, connect, refreshTick, bumpRefresh } = useWallet();
  const [tokens, setTokens] = useState<TokensResp | null>(null);
  const [uiTokens, setUiTokens] = useState<UiToken[]>([]);
  const [payIdx, setPayIdx] = useState(0);
  const [recvIdx, setRecvIdx] = useState(1);
  const [amountIn, setAmountIn] = useState<string>("");
  const [quoteOut, setQuoteOut] = useState<bigint | null>(null);
  const [quotePath, setQuotePath] = useState<string[] | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [pending, setPending] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successHash, setSuccessHash] = useState<string | undefined>();

  const pay = uiTokens[payIdx];
  const recv = uiTokens[recvIdx];

  // Load tokens
  useEffect(() => {
    let alive = true;
    dexApi
      .tokens()
      .then((t) => {
        if (!alive) return;
        setTokens(t);
        setUiTokens(buildUiTokens(t));
      })
      .catch((e) => {
        console.error("Failed to load token list", e);
        toast.error(`Failed to load token list: ${e?.message ?? e}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load balances + allowance
  const refreshBalances = useCallback(async () => {
    if (!address || uiTokens.length === 0 || !tokens) return;
    try {
      const provider = await getProvider();
      const entries: [string, bigint][] = [];
      for (const t of uiTokens) {
        if (t.isNative) {
          const bal = await provider.getBalance(address);
          entries.push([t.symbol, bal]);
        } else {
          const c = new Contract(t.address, ERC20_ABI, provider);
          const bal: bigint = await c.balanceOf(address);
          entries.push([t.symbol, bal]);
        }
      }
      setBalances(Object.fromEntries(entries));
      // allowance for pay token
      if (pay && !pay.isNative) {
        const c = new Contract(pay.address, ERC20_ABI, provider);
        const a: bigint = await c.allowance(address, tokens.router);
        setAllowance(a);
      } else {
        setAllowance(MaxUint256);
      }
    } catch {
      // ignore
    }
  }, [address, uiTokens, tokens, pay]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances, refreshTick]);

  // Debounced getAmountsOut
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!tokens || !pay || !recv) return;
    if (!amountIn || Number(amountIn) <= 0) {
      setQuoteOut(null);
      setQuotePath(null);
      setQuoteError(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setQuoting(true);
    setQuoteError(null);
    quoteTimer.current = setTimeout(async () => {
      try {
        const provider = await getProvider();
        const router = new Contract(tokens.router, ROUTER_ABI, provider);
        const amt = parseUnits(amountIn, pay.decimals);
        const weth = tokens.weth;
        const candidates: string[][] = [[pay.address, recv.address]];
        const isWethish = (a: string) => a.toLowerCase() === weth.toLowerCase();
        if (!isWethish(pay.address) && !isWethish(recv.address)) {
          candidates.push([pay.address, weth, recv.address]);
        }
        let resolved: { path: string[]; out: bigint } | null = null;
        for (const path of candidates) {
          try {
            const out: bigint[] = await router.getAmountsOut(amt, path);
            console.log("[swap] quote path", path, out.map(String));
            resolved = { path, out: out[out.length - 1] };
            break;
          } catch (err) {
            console.warn("[swap] path failed", path, err);
          }
        }
        if (!resolved) {
          setQuoteOut(null);
          setQuotePath(null);
          setQuoteError("No route available for this pair.");
        } else {
          setQuoteOut(resolved.out);
          setQuotePath(resolved.path);
        }
      } catch {
        setQuoteOut(null);
        setQuotePath(null);
        setQuoteError("Failed to fetch quote.");
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [amountIn, pay, recv, tokens]);

  const payBal = pay ? balances[pay.symbol] ?? 0n : 0n;
  const recvBal = recv ? balances[recv.symbol] ?? 0n : 0n;

  // slider %
  const [sliderPct, setSliderPct] = useState(0);
  useEffect(() => {
    // sync slider when balance/amount change if user typed
    if (!pay) return;
    if (!amountIn) {
      setSliderPct(0);
      return;
    }
    try {
      const amt = parseUnits(amountIn, pay.decimals);
      const usable = pay.isNative
        ? payBal > NATIVE_GAS_BUFFER
          ? payBal - NATIVE_GAS_BUFFER
          : 0n
        : payBal;
      if (usable === 0n) return;
      const pct = Number((amt * 10000n) / usable) / 100;
      setSliderPct(Math.max(0, Math.min(100, pct)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn]);

  const setPct = (pct: number) => {
    if (!pay) return;
    setSliderPct(pct);
    const usable = pay.isNative
      ? payBal > NATIVE_GAS_BUFFER
        ? payBal - NATIVE_GAS_BUFFER
        : 0n
      : payBal;
    const amt = (usable * BigInt(Math.round(pct * 100))) / 10000n;
    setAmountIn(pct === 0 ? "" : formatUnits(amt, pay.decimals));
  };

  const flip = () => {
    setPayIdx(recvIdx);
    setRecvIdx(payIdx);
    setAmountIn("");
    setQuoteOut(null);
  };

  const needApproval = useMemo(() => {
    if (!pay || pay.isNative || !amountIn) return false;
    try {
      return allowance < parseUnits(amountIn, pay.decimals);
    } catch {
      return false;
    }
  }, [pay, amountIn, allowance]);

  const priceStr = useMemo(() => {
    if (!pay || !recv || !quoteOut || !amountIn) return null;
    try {
      const inN = Number(amountIn);
      const outN = Number(formatUnits(quoteOut, recv.decimals));
      if (inN <= 0) return null;
      const rate = outN / inN;
      return `1 ${pay.symbol} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${recv.symbol}`;
    } catch {
      return null;
    }
  }, [pay, recv, quoteOut, amountIn]);

  const doApprove = async () => {
    if (!pay || !tokens || !address) return;
    setPending("approve");
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const c = new Contract(pay.address, ERC20_ABI, signer);
      const tx = await c.approve(tokens.router, MaxUint256);
      toast.message(`Approving ${pay.symbol}…`);
      const rc = await tx.wait();
      toast.success(`${pay.symbol} approved`, {
        action: rc?.hash
          ? { label: "View", onClick: () => window.open(explorerTx(rc.hash), "_blank") }
          : undefined,
      });
      bumpRefresh();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  const doSwap = async () => {
    if (!pay || !recv || !tokens || !address || !quoteOut || !amountIn || !quotePath) return;
    setPending("swap");
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const router = new Contract(tokens.router, ROUTER_ABI, signer);
      const amt = parseUnits(amountIn, pay.decimals);
      const minOut = (quoteOut * BigInt(Math.round((100 - slippage) * 100))) / 10000n;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const path = quotePath;
      let tx;
      if (pay.isNative) {
        tx = await router.swapExactETHForTokens(minOut, path, address, deadline, { value: amt });
      } else if (recv.isNative) {
        tx = await router.swapExactTokensForETH(amt, minOut, path, address, deadline);
      } else {
        tx = await router.swapExactTokensForTokens(amt, minOut, path, address, deadline);
      }
      toast.message("Swap submitted", { description: "Waiting for confirmation." });
      const rc = await tx.wait();
      setSuccessHash(rc?.hash);
      setSuccessOpen(true);
      setAmountIn("");
      setQuoteOut(null);
      setQuotePath(null);
      bumpRefresh();
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(null);
    }
  };

  // Primary button state
  let btnLabel = "Swap";
  let btnDisabled = false;
  let btnAction: (() => void) | null = doSwap;
  if (!address) {
    btnLabel = "Connect Wallet";
    btnAction = () => connect();
  } else if (!onGiwa) {
    btnLabel = "Switch to GIWA Testnet";
    btnAction = () => ensureGiwaNetwork().catch((e) => toast.error(decodeWalletError(e)));
  } else if (!amountIn || Number(amountIn) <= 0) {
    btnLabel = "Enter an amount";
    btnDisabled = true;
  } else {
    try {
      const amt = parseUnits(amountIn, pay?.decimals ?? 18);
      if (amt > payBal) {
        btnLabel = `Insufficient ${pay?.symbol}`;
        btnDisabled = true;
      } else if (needApproval) {
        btnLabel = `Approve ${pay?.symbol}`;
        btnAction = doApprove;
      } else if (quoteError) {
        btnLabel = "No route available";
        btnDisabled = true;
      } else if (!quoteOut) {
        btnLabel = "Fetching quote…";
        btnDisabled = true;
      }
    } catch {
      btnLabel = "Invalid amount";
      btnDisabled = true;
    }
  }
  if (pending) {
    btnLabel = pending === "approve" ? "Approving…" : "Swapping…";
    btnDisabled = true;
  }

  return (
    <div className="card-panel p-5">
      <SuccessDialog
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        title="Swap complete"
        description={
          pay && recv ? `Swapped ${pay.symbol} → ${recv.symbol}.` : undefined
        }
        txHash={successHash}
        explorerUrl={successHash ? explorerTx(successHash) : undefined}
      />
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Swap tokens</div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowSettings((v) => !v)}
        >
          ⚙ {slippage}% slippage
        </button>
      </div>
      {showSettings && (
        <div className="mb-4 rounded-md border border-border bg-[var(--muted)] p-3 text-xs">
          <label className="block">
            <span className="text-muted-foreground">Slippage tolerance (%)</span>
            <input
              type="number"
              step="0.1"
              min="0.05"
              max="50"
              className="input-field mt-1"
              value={slippage}
              onChange={(e) => setSlippage(Math.max(0.05, Number(e.target.value) || 0))}
            />
          </label>
        </div>
      )}

      <TokenInputCard
        label="You pay"
        tokens={uiTokens}
        selectedIdx={payIdx}
        onSelect={(i) => {
          if (i === recvIdx) setRecvIdx(payIdx);
          setPayIdx(i);
          setAmountIn("");
        }}
        amount={amountIn}
        onAmount={setAmountIn}
        balance={payBal}
      />

      <div className="my-2">
        <label className="block text-xs text-muted-foreground">Amount %</label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(sliderPct)}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full accent-[var(--primary)]"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          {[0, 25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => setPct(p)} className="hover:text-foreground">
              {p}%
            </button>
          ))}
        </div>
      </div>

      <div className="my-2 flex justify-center">
        <button
          onClick={flip}
          className="rounded-full border border-border bg-white p-2 hover:border-[var(--primary)]"
          aria-label="Flip"
        >
          ↕
        </button>
      </div>

      <TokenInputCard
        label="You receive"
        tokens={uiTokens}
        selectedIdx={recvIdx}
        onSelect={(i) => {
          if (i === payIdx) setPayIdx(recvIdx);
          setRecvIdx(i);
        }}
        amount={
          quoteOut && recv
            ? Number(formatUnits(quoteOut, recv.decimals)).toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })
            : ""
        }
        onAmount={() => {}}
        balance={recvBal}
        readOnly
      />

      <div className="mt-3 min-h-[1.25rem] text-xs text-muted-foreground">
        {quoting ? "Fetching quote…" : quoteError ? quoteError : priceStr}
      </div>

      <button
        className="btn-primary mt-4 w-full"
        disabled={btnDisabled || !btnAction}
        onClick={() => btnAction?.()}
      >
        {btnLabel}
      </button>
    </div>
  );
}

function TokenInputCard({
  label,
  tokens,
  selectedIdx,
  onSelect,
  amount,
  onAmount,
  balance,
  readOnly,
}: {
  label: string;
  tokens: UiToken[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  amount: string;
  onAmount: (v: string) => void;
  balance: bigint;
  readOnly?: boolean;
}) {
  const t = tokens[selectedIdx];
  return (
    <div className="rounded-lg border border-border bg-[var(--muted)] p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          Balance:{" "}
          <span className="font-mono">
            {t ? fmtUnits(balance, t.decimals, 4) : "0"}
          </span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          readOnly={readOnly}
          onChange={(e) => onAmount(e.target.value.replace(/,/g, ""))}
          className="w-full bg-transparent text-2xl font-semibold outline-none"
        />
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-sm font-semibold">
          <TokenIcon symbol={t?.symbol} size={20} />
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
      </div>
    </div>
  );
}