import { useEffect, useMemo, useState } from "react";
import { Contract, parseUnits, formatUnits, MaxUint256 } from "ethers";
import { ArrowDownUp, Settings } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useTokens, useBalances } from "@/hooks/useDex";
import { ERC20_ABI, ROUTER_ABI } from "@/lib/abis";
import type { TokenInfo } from "@/lib/giwa";
import { runTx } from "@/lib/tx";
import { TokenSelect } from "./TokenSelect";

const GAS_BUFFER_ETH = 0.0005;

export function SwapTab() {
  const { address, provider, getSigner, connect, isCorrectChain, switchNetwork, bumpRefresh } =
    useWallet();
  const { data: cfg } = useTokens();
  const tokens = cfg?.tokens;
  const { data: bals } = useBalances(tokens);

  const [tokenIn, setTokenIn] = useState<TokenInfo | null>(null);
  const [tokenOut, setTokenOut] = useState<TokenInfo | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);

  // set initial tokens
  useEffect(() => {
    if (!tokens || tokenIn) return;
    const giwa = tokens.find((t) => t.symbol === "GIWA");
    const gdex = tokens.find((t) => t.symbol === "GDEX");
    if (giwa) setTokenIn(giwa);
    if (gdex) setTokenOut(gdex);
  }, [tokens, tokenIn]);

  const balIn = tokenIn ? bals?.[tokenIn.symbol] ?? "0" : "0";
  const balOut = tokenOut ? bals?.[tokenOut.symbol] ?? "0" : "0";

  // get quote
  useEffect(() => {
    if (!tokenIn || !tokenOut || !amountIn || !provider || !cfg) {
      setAmountOut("");
      return;
    }
    const n = Number(amountIn);
    if (!n || n <= 0) {
      setAmountOut("");
      return;
    }
    const t = setTimeout(async () => {
      try {
        const router = new Contract(cfg.router, ROUTER_ABI, provider);
        const path = [tokenIn.address, tokenOut.address];
        const amounts: bigint[] = await router.getAmountsOut(
          parseUnits(amountIn, tokenIn.decimals),
          path,
        );
        setAmountOut(formatUnits(amounts[amounts.length - 1], tokenOut.decimals));
      } catch {
        setAmountOut("");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amountIn, tokenIn, tokenOut, provider, cfg]);

  // allowance
  useEffect(() => {
    if (!tokenIn || !address || !provider || !cfg || tokenIn.symbol === "GIWA") {
      setAllowance(MaxUint256);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const c = new Contract(tokenIn.address, ERC20_ABI, provider);
        const a: bigint = await c.allowance(address, cfg.router);
        if (!cancel) setAllowance(a);
      } catch {}
    })();
    return () => {
      cancel = true;
    };
  }, [tokenIn, address, provider, cfg]);

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut);
    setAmountOut("");
  };

  const setPct = (pct: number) => {
    if (!tokenIn) return;
    let max = Number(balIn);
    if (tokenIn.symbol === "GIWA") max = Math.max(0, max - GAS_BUFFER_ETH);
    const v = (max * pct) / 100;
    setAmountIn(v > 0 ? String(Number(v.toFixed(8))) : "");
  };

  const rate = useMemo(() => {
    const a = Number(amountIn);
    const b = Number(amountOut);
    if (!a || !b || !tokenIn || !tokenOut) return null;
    return `1 ${tokenIn.symbol} ≈ ${(b / a).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenOut.symbol}`;
  }, [amountIn, amountOut, tokenIn, tokenOut]);

  const needsApproval =
    tokenIn &&
    tokenIn.symbol !== "GIWA" &&
    amountIn &&
    (() => {
      try {
        return parseUnits(amountIn, tokenIn.decimals) > allowance;
      } catch {
        return false;
      }
    })();

  const insufficient =
    tokenIn && amountIn && Number(amountIn) > Number(balIn);

  const buttonLabel = !address
    ? "Connect Wallet"
    : !isCorrectChain
      ? "Switch Network"
      : !amountIn || Number(amountIn) <= 0
        ? "Enter an amount"
        : insufficient
          ? `Insufficient ${tokenIn?.symbol}`
          : needsApproval
            ? `Approve ${tokenIn?.symbol}`
            : "Swap";

  const buttonDisabled =
    !!address && isCorrectChain && (!amountIn || Number(amountIn) <= 0 || !!insufficient || busy);

  const handleClick = async () => {
    if (!address) return connect();
    if (!isCorrectChain) return switchNetwork();
    if (!tokenIn || !tokenOut || !cfg || !amountIn) return;
    setBusy(true);
    try {
      const signer = await getSigner();
      if (needsApproval) {
        const c = new Contract(tokenIn.address, ERC20_ABI, signer);
        const h = await runTx(`Approve ${tokenIn.symbol}`, () => c.approve(cfg.router, MaxUint256));
        if (h) setAllowance(MaxUint256);
        return;
      }
      const router = new Contract(cfg.router, ROUTER_ABI, signer);
      const amtIn = parseUnits(amountIn, tokenIn.decimals);
      const minOut = parseUnits(
        (Number(amountOut) * (1 - slippage / 100)).toFixed(tokenOut.decimals),
        tokenOut.decimals,
      );
      const path = [tokenIn.address, tokenOut.address];
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

      let fn: () => Promise<any>;
      if (tokenIn.symbol === "GIWA") {
        fn = () => router.swapExactETHForTokens(minOut, path, address, deadline, { value: amtIn });
      } else if (tokenOut.symbol === "GIWA") {
        fn = () => router.swapExactTokensForETH(amtIn, minOut, path, address, deadline);
      } else {
        fn = () => router.swapExactTokensForTokens(amtIn, minOut, path, address, deadline);
      }
      const h = await runTx("Swap", fn);
      if (h) {
        setAmountIn("");
        setAmountOut("");
        bumpRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!tokenIn || !tokenOut || !tokens) {
    return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="card-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Swap</h2>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        {showSettings && (
          <div className="mb-3 rounded-lg bg-muted p-3 text-sm">
            <div className="mb-2 font-medium">Slippage tolerance</div>
            <div className="flex gap-2">
              {[0.1, 0.5, 1].map((v) => (
                <button
                  key={v}
                  onClick={() => setSlippage(v)}
                  className={`rounded-md px-2 py-1 text-xs ${slippage === v ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  {v}%
                </button>
              ))}
              <input
                type="number"
                value={slippage}
                onChange={(e) => setSlippage(Number(e.target.value) || 0)}
                className="input-field !py-1 !text-xs"
                style={{ maxWidth: 80 }}
              />
            </div>
          </div>
        )}

        {/* Pay */}
        <TokenBox
          label="You pay"
          token={tokenIn}
          amount={amountIn}
          onAmount={setAmountIn}
          balance={balIn}
          tokens={tokens}
          onToken={setTokenIn}
          disabledSymbol={tokenOut.symbol}
        />

        {/* slider */}
        <div className="mt-2 px-1">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pctFromAmount(amountIn, balIn, tokenIn.symbol)}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
            list="pctmarks"
          />
          <datalist id="pctmarks">
            <option value="0" />
            <option value="25" />
            <option value="50" />
            <option value="75" />
            <option value="100" />
          </datalist>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
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
            className="rounded-lg border border-border bg-background p-1.5 hover:bg-muted"
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        <TokenBox
          label="You receive"
          token={tokenOut}
          amount={amountOut}
          onAmount={() => {}}
          balance={balOut}
          tokens={tokens}
          onToken={setTokenOut}
          disabledSymbol={tokenIn.symbol}
          readOnly
        />

        {rate && (
          <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {rate} · slippage {slippage}%
          </div>
        )}

        <button
          onClick={handleClick}
          disabled={buttonDisabled}
          className="mt-3 w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

function pctFromAmount(amt: string, bal: string, sym: string): number {
  const n = Number(amt);
  let max = Number(bal);
  if (sym === "GIWA") max = Math.max(0, max - GAS_BUFFER_ETH);
  if (!max || !n) return 0;
  return Math.min(100, Math.round((n / max) * 100));
}

function TokenBox({
  label,
  token,
  amount,
  onAmount,
  balance,
  tokens,
  onToken,
  disabledSymbol,
  readOnly,
}: {
  label: string;
  token: TokenInfo;
  amount: string;
  onAmount: (v: string) => void;
  balance: string;
  tokens: TokenInfo[];
  onToken: (t: TokenInfo) => void;
  disabledSymbol?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>Balance: {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          readOnly={readOnly}
          onChange={(e) => onAmount(e.target.value)}
          className="flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/40"
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