import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ContractFactory,
  Contract,
  parseUnits,
  type BrowserProvider,
  type JsonRpcSigner,
} from "ethers";
import {
  api,
  EXPLORER,
  GIWA_CHAIN,
  BASE_CHAIN,
  BASE_USDC,
  BASE_USDC_DECIMALS,
  DONATION_ADDRESS,
  type BalanceResp,
  type DeployInfoResp,
  type DeploymentRecord,
  type FaucetsResp,
} from "@/lib/giwa";
import {
  connectWallet,
  ensureBaseNetwork,
  ensureGiwaNetwork,
  getCurrentChainIdHex,
  getEthereum,
  getProvider,
  truncate,
} from "@/lib/wallet";

type StepStatus = "idle" | "pending" | "awaiting" | "confirming" | "done" | "error";

type DeployStep = {
  key: "weth" | "factory" | "router";
  label: string;
  status: StepStatus;
  address?: string;
  txHash?: string;
  error?: string;
};

const STEPS = ["Connect Wallet", "Get Sepolia ETH", "Bridge to GIWA", "Deploy Your DEX"] as const;

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const initialDeploySteps = (): DeployStep[] => [
  { key: "weth", label: "Deploy WETH", status: "idle" },
  { key: "factory", label: "Deploy Factory", status: "idle" },
  { key: "router", label: "Deploy Router", status: "idle" },
];

export function DexWizard() {
  const [step, setStep] = useState(1);
  const [address, setAddress] = useState<string | null>(null);
  const [chainIdHex, setChainIdHex] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // step 2
  const [faucets, setFaucets] = useState<FaucetsResp | null>(null);

  // step 3
  const [balance, setBalance] = useState<BalanceResp | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // step 4 form
  const [dexName, setDexName] = useState("");
  const [dexSymbol, setDexSymbol] = useState("");
  const [deployInfo, setDeployInfo] = useState<DeployInfoResp | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>(initialDeploySteps);
  const [deploying, setDeploying] = useState(false);

  // history + donation
  const [history, setHistory] = useState<DeploymentRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);

  const resetAccountState = useCallback(() => {
    setBalance(null);
    setBalanceError(null);
    setDexName("");
    setDexSymbol("");
    setDeployInfo(null);
    setPrepError(null);
    setDeploySteps(initialDeploySteps());
    setDeploying(false);
    setHistory(null);
    setStep(1);
  }, []);

  // Load faucets when step 2 opens
  useEffect(() => {
    if (step >= 2 && !faucets) {
      api.faucets().then(setFaucets).catch(() => {});
    }
  }, [step, faucets]);

  // Wallet event listeners
  useEffect(() => {
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => {
      const next = accs?.[0] ?? null;
      if (!next) {
        setAddress(null);
        resetAccountState();
        return;
      }
      // switch to fresh state for new address
      resetAccountState();
      setAddress(next);
      setStep(2);
    };
    const onChain = (cid: string) => setChainIdHex(cid);
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [resetAccountState]);

  // On mount: probe chain
  useEffect(() => {
    getCurrentChainIdHex().then(setChainIdHex).catch(() => {});
  }, []);

  // Balance load on step 3
  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const b = await api.balance(address);
      setBalance(b);
    } catch (e: any) {
      setBalanceError(e?.message ?? "Balance check failed");
    } finally {
      setBalanceLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (step === 3 && address && !balance) refreshBalance();
  }, [step, address, balance, refreshBalance]);

  // History load whenever address changes
  const refreshHistory = useCallback(async (a: string) => {
    setHistoryLoading(true);
    try {
      const res = await api.listDeployments(a);
      setHistory(res.deployments);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address) refreshHistory(address);
    else setHistory(null);
  }, [address, refreshHistory]);

  async function handleConnect() {
    setConnectError(null);
    setConnecting(true);
    try {
      const a = await connectWallet();
      await ensureGiwaNetwork();
      setAddress(a);
      setChainIdHex(await getCurrentChainIdHex());
      setStep(2);
    } catch (e: any) {
      setConnectError(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    setAddress(null);
    resetAccountState();
  }

  const nameValid = dexName.trim().length >= 1 && dexName.trim().length <= 32;
  const symbolTrim = dexSymbol.trim();
  const symbolValid = /^[A-Za-z0-9]{2,10}$/.test(symbolTrim);
  const formValid = nameValid && symbolValid;

  async function startDeploy() {
    if (!formValid || !address) return;
    setPrepError(null);
    setPreparing(true);
    try {
      const info = await api.deployInfo(dexName.trim(), symbolTrim);
      setDeployInfo(info);
      await runDeploy(info);
    } catch (e: any) {
      setPrepError(e?.message ?? "Failed to prepare deployment");
    } finally {
      setPreparing(false);
    }
  }

  function updateDeployStep(key: DeployStep["key"], patch: Partial<DeployStep>) {
    setDeploySteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function runDeploy(info: DeployInfoResp) {
    if (!address) return;
    setDeploying(true);
    // reset step statuses
    setDeploySteps(initialDeploySteps());
    try {
      await ensureGiwaNetwork();
      const provider: BrowserProvider = await getProvider();
      const signer: JsonRpcSigner = await provider.getSigner();

      // WETH
      updateDeployStep("weth", { status: "awaiting" });
      const wethFactory = new ContractFactory(info.weth.abi, info.weth.bytecode, signer);
      const weth = await wethFactory.deploy();
      const wethTx = weth.deploymentTransaction();
      updateDeployStep("weth", { status: "confirming", txHash: wethTx?.hash });
      await weth.waitForDeployment();
      const wethAddr = await weth.getAddress();
      updateDeployStep("weth", { status: "done", address: wethAddr });

      // Factory
      updateDeployStep("factory", { status: "awaiting" });
      const factoryFactory = new ContractFactory(info.factory.abi, info.factory.bytecode, signer);
      const factory = await factoryFactory.deploy(info.dexName, address);
      const facTx = factory.deploymentTransaction();
      updateDeployStep("factory", { status: "confirming", txHash: facTx?.hash });
      await factory.waitForDeployment();
      const factoryAddr = await factory.getAddress();
      updateDeployStep("factory", { status: "done", address: factoryAddr });

      // Router
      updateDeployStep("router", { status: "awaiting" });
      const routerFactory = new ContractFactory(info.router.abi, info.router.bytecode, signer);
      const router = await routerFactory.deploy(factoryAddr, wethAddr);
      const rTx = router.deploymentTransaction();
      updateDeployStep("router", { status: "confirming", txHash: rTx?.hash });
      await router.waitForDeployment();
      const routerAddr = await router.getAddress();
      updateDeployStep("router", { status: "done", address: routerAddr });

      // Save to history
      try {
        const saved = await api.saveDeployment({
          deployerAddress: address,
          dexName: info.dexName,
          dexSymbol: info.dexSymbol,
          wethAddress: wethAddr,
          factoryAddress: factoryAddr,
          routerAddress: routerAddr,
          wethTxHash: wethTx?.hash,
          factoryTxHash: facTx?.hash,
          routerTxHash: rTx?.hash,
        });
        setHistory((prev) => (prev ? [saved, ...prev] : [saved]));
      } catch {
        // non-fatal — still refresh
        refreshHistory(address);
      }
    } catch (e: any) {
      const msg = decodeWalletError(e);
      setDeploySteps((prev) => {
        const idx = prev.findIndex((s) => s.status === "awaiting" || s.status === "confirming");
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], status: "error", error: msg };
        return next;
      });
    } finally {
      setDeploying(false);
    }
  }

  const allDone = deploySteps.every((s) => s.status === "done");
  const onGiwa = chainIdHex?.toLowerCase() === GIWA_CHAIN.chainIdHex.toLowerCase();
  const wrongChain = !!address && chainIdHex !== null && !onGiwa;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <TopBar
        address={address}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenDonate={() => setDonateOpen(true)}
        onDisconnect={handleDisconnect}
      />
      <Header />

      {wrongChain && (
        <div className="mb-6 rounded-lg border border-[var(--warning)]/40 bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] p-3 text-sm">
          Your wallet is on a different network.
          <button
            className="ml-2 underline font-medium"
            onClick={() => ensureGiwaNetwork().catch((e) => toast.error(decodeWalletError(e)))}
          >
            Switch to GIWA Testnet
          </button>
        </div>
      )}

      <ProgressBar current={step} />

      <div className="mt-8 space-y-6">
        <StepCard n={1} title={STEPS[0]} active={step === 1} done={step > 1}>
          <p className="text-sm text-muted-foreground">
            MetaMask popup — you approve, we only ever see your public address. We never ask for
            private keys or seed phrases.
          </p>
          {address ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--muted)] px-3 py-1">
                <span className="font-mono text-sm">{truncate(address)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                connected · {onGiwa ? "GIWA testnet" : "wrong network"}
              </span>
              <button className="btn-outline text-xs" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <button className="btn-primary" onClick={handleConnect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect Wallet"}
              </button>
              {connectError && <ErrorLine msg={connectError} />}
            </div>
          )}
        </StepCard>

        <StepCard n={2} title={STEPS[1]} active={step === 2} done={step > 2} locked={step < 2}>
          <p className="text-sm text-muted-foreground">
            Grab test ETH on Sepolia from any of these faucets. Claiming happens on their site, in
            your wallet.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {faucets?.sepoliaFaucets.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline text-sm text-center"
              >
                {f.name} ↗
              </a>
            ))}
          </div>
          {step === 2 && (
            <div className="mt-5">
              <button className="btn-primary" onClick={() => setStep(3)}>
                I've claimed, continue
              </button>
            </div>
          )}
        </StepCard>

        <StepCard n={3} title={STEPS[2]} active={step === 3} done={step > 3} locked={step < 3}>
          <p className="text-sm text-muted-foreground">
            One button, one signature. Sepolia ETH → GIWA testnet ETH. Bridging happens on the
            bridge's site, in your wallet.
          </p>
          {faucets?.giwaBridge && (
            <div className="mt-4">
              <a
                href={faucets.giwaBridge.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-block"
              >
                Bridge to GIWA ↗
              </a>
              <p className="mt-2 text-xs text-muted-foreground">
                Note: the bridge is a community tool, not an official GIWA product.
              </p>
            </div>
          )}
          <div className="mt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Or claim GIWA testnet ETH directly:
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <a href="https://faucet.giwa.io/#/" target="_blank" rel="noopener noreferrer" className="btn-outline text-sm text-center">
                GIWA official faucet ↗
              </a>
              <a href="https://faucet.trade/giwa-sepolia-eth-faucet" target="_blank" rel="noopener noreferrer" className="btn-outline text-sm text-center">
                Faucet.trade ↗
              </a>
              <a href="https://faucet.lambda256.io/giwa-sepolia" target="_blank" rel="noopener noreferrer" className="btn-outline text-sm text-center">
                Lambda256 ↗
              </a>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-border bg-[var(--muted)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  GIWA balance
                </div>
                <div className="mt-1 font-mono text-lg">
                  {balance ? `${balance.balanceEth} ETH` : balanceLoading ? "…" : "—"}
                </div>
              </div>
              <button
                className="btn-outline text-sm"
                onClick={refreshBalance}
                disabled={balanceLoading}
              >
                {balanceLoading ? "Checking…" : "Recheck balance"}
              </button>
            </div>
            {balanceError && <ErrorLine msg={balanceError} />}
            {balance && !balance.hasFunds && (
              <p className="mt-3 text-sm text-[var(--warning)]">
                You need GIWA testnet ETH before deploying. Use the bridge above, then recheck.
              </p>
            )}
            {balance?.hasFunds && step === 3 && (
              <button className="btn-primary mt-4" onClick={() => setStep(4)}>
                Continue to deploy
              </button>
            )}
          </div>
        </StepCard>

        <StepCard n={4} title={STEPS[3]} active={step === 4} done={allDone} locked={step < 4}>
          {!allDone && !deploying && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choose your DEX name and token symbol. This is permanent and on-chain.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">DEX Name</span>
                  <input
                    className="input-field mt-1"
                    placeholder="MyAwesomeDEX"
                    value={dexName}
                    onChange={(e) => setDexName(e.target.value)}
                    maxLength={40}
                  />
                  {dexName.length > 0 && !nameValid && (
                    <span className="mt-1 block text-xs text-[var(--destructive)]">
                      1–32 characters required.
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">DEX Symbol</span>
                  <input
                    className="input-field mt-1 font-mono"
                    placeholder="MAD"
                    value={dexSymbol}
                    onChange={(e) => setDexSymbol(e.target.value)}
                    maxLength={12}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    2–10 chars, alphanumeric. Usually uppercase, e.g. MAD.
                  </span>
                  {symbolTrim.length > 0 && !symbolValid && (
                    <span className="mt-1 block text-xs text-[var(--destructive)]">
                      Only letters and digits, 2–10 chars.
                    </span>
                  )}
                </label>
              </div>

              {formValid && (
                <div className="rounded-lg border border-border bg-[var(--muted)] p-3 text-sm">
                  Deploying:{" "}
                  <span className="font-semibold">{dexName.trim()}</span>{" "}
                  <span className="font-mono text-muted-foreground">({symbolTrim})</span>
                </div>
              )}

              {prepError && <ErrorLine msg={prepError} />}

              <button
                className="btn-primary"
                onClick={startDeploy}
                disabled={!formValid || preparing}
              >
                {preparing ? "Preparing…" : "Deploy"}
              </button>
              <p className="text-xs text-muted-foreground">
                3 signatures — WETH, Factory, Router. Each approved individually in your wallet.
              </p>
            </div>
          )}

          {(deploying || deploySteps.some((s) => s.status !== "idle")) && (
            <>
              <div className="mt-2 space-y-2">
                {deploySteps.map((s, i) => (
                  <DeployRow key={s.key} index={i + 1} step={s} />
                ))}
              </div>

              {!allDone && !deploying && deploySteps.some((s) => s.status === "error") && (
                <div className="mt-5">
                  <button
                    className="btn-primary"
                    onClick={() => deployInfo && runDeploy(deployInfo)}
                  >
                    Retry deployment
                  </button>
                </div>
              )}

              {allDone && (
                <SuccessSummary
                  name={deployInfo?.dexName ?? dexName.trim()}
                  symbol={deployInfo?.dexSymbol ?? symbolTrim}
                  steps={deploySteps}
                />
              )}
            </>
          )}
        </StepCard>
      </div>

      <footer className="mt-10 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
        <button className="btn-outline text-xs" onClick={() => setDonateOpen(true)}>
          ♥ Support this project
        </button>
        <span>Stateless deploys. No accounts. No keys. Your wallet signs everything.</span>
      </footer>

      {historyOpen && (
        <HistoryPanel
          address={address}
          history={history}
          loading={historyLoading}
          onClose={() => setHistoryOpen(false)}
          onRefresh={() => address && refreshHistory(address)}
        />
      )}
      {donateOpen && (
        <DonateModal address={address} onClose={() => setDonateOpen(false)} />
      )}
    </div>
  );
}

function TopBar({
  address,
  onOpenHistory,
  onOpenDonate,
  onDisconnect,
}: {
  address: string | null;
  onOpenHistory: () => void;
  onOpenDonate: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      {address && (
        <>
          <button className="btn-outline text-xs" onClick={onOpenHistory}>
            My Deployments
          </button>
          <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-mono">
            {truncate(address)}
          </span>
          <button className="btn-outline text-xs" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      )}
      <button className="btn-outline text-xs" onClick={onOpenDonate}>
        ♥ Donate
      </button>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <img
        src="/giwa-logo.jpg"
        alt="GIWA logo"
        className="mb-3 h-16 w-16 rounded-lg object-cover shadow-sm"
      />
      <h1 className="text-5xl font-extrabold tracking-tight text-[var(--primary)] sm:text-6xl">
        GIWA
      </h1>
      <p className="mt-1 text-2xl italic text-foreground sm:text-3xl">DEX Deployer</p>
    </div>
  );
}

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : active
                    ? "bg-white border border-[var(--primary)] text-[var(--primary)]"
                    : "bg-[var(--muted)] text-muted-foreground"
              }`}
            >
              {done ? "✓" : n}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-[var(--primary)]" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({
  n,
  title,
  active,
  done,
  locked,
  children,
}: {
  n: number;
  title: string;
  active?: boolean;
  done?: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`card-panel p-5 sm:p-6 transition-opacity ${
        locked ? "opacity-40 pointer-events-none" : ""
      } ${active ? "ring-1 ring-[var(--primary)]" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          <span className="text-muted-foreground mr-2">{n}.</span>
          {title}
        </h2>
        {done && <span className="text-xs font-medium text-[var(--success)]">Complete</span>}
      </div>
      {children}
    </section>
  );
}

function DeployRow({ index, step }: { index: number; step: DeployStep }) {
  const statusText: Record<StepStatus, string> = {
    idle: "Pending",
    pending: "Pending",
    awaiting: "Awaiting signature…",
    confirming: "Confirming on-chain…",
    done: "Done",
    error: "Failed",
  };
  const dot: Record<StepStatus, string> = {
    idle: "bg-muted-foreground/40",
    pending: "bg-muted-foreground/40",
    awaiting: "bg-[var(--warning)] animate-pulse",
    confirming: "bg-[var(--accent)] animate-pulse",
    done: "bg-[var(--success)]",
    error: "bg-[var(--destructive)]",
  };
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-[var(--muted)] p-3">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 inline-block h-2.5 w-2.5 rounded-full ${dot[step.status]}`} />
        <div>
          <div className="text-sm font-medium">
            <span className="text-muted-foreground mr-2">{index}.</span>
            {step.label}
          </div>
          <div className="text-xs text-muted-foreground">{statusText[step.status]}</div>
          {step.address && (
            <a
              href={`${EXPLORER}/address/${step.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block break-all font-mono text-xs text-[var(--primary)] hover:underline"
            >
              {step.address}
            </a>
          )}
          {step.error && <ErrorLine msg={step.error} />}
        </div>
      </div>
    </div>
  );
}

function ContractRows({
  rows,
}: {
  rows: { label: string; address: string }[];
}) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-white">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="inline-flex min-w-16 justify-center rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--primary)]">
            {r.label}
          </span>
          <span className="flex-1 truncate font-mono text-xs text-foreground" title={r.address}>
            {truncate(r.address)}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground"
              title="Copy address"
              onClick={async () => {
                await navigator.clipboard.writeText(r.address);
                toast.success(`${r.label} address copied`);
              }}
            >
              📋
            </button>
            <a
              className="rounded p-1.5 text-muted-foreground hover:bg-[var(--muted)] hover:text-[var(--primary)]"
              href={`${EXPLORER}/address/${r.address}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in explorer"
            >
              ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

function SuccessSummary({
  name,
  symbol,
  steps,
}: {
  name: string;
  symbol: string;
  steps: DeployStep[];
}) {
  const [weth, factory, router] = steps;
  const summary = useMemo(
    () =>
      `${name} (${symbol}) — GIWA Testnet\nWETH:    ${weth.address}\nFactory: ${factory.address}\nRouter:  ${router.address}\nExplorer: ${EXPLORER}/address/${router.address}`,
    [name, symbol, weth.address, factory.address, router.address],
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-4">
      <div className="text-sm font-semibold text-[var(--primary)]">
        🎉 Your DEX is live on GIWA testnet
      </div>
      <div className="mt-1 text-sm text-foreground">
        <span className="font-semibold">{name}</span>{" "}
        <span className="font-mono text-muted-foreground">({symbol})</span>
      </div>
      <div className="mt-3">
        <ContractRows
          rows={[
            { label: "WETH", address: weth.address! },
            { label: "Factory", address: factory.address! },
            { label: "Router", address: router.address! },
          ]}
        />
      </div>
      <button
        className="btn-outline mt-3 text-xs"
        onClick={async () => {
          await navigator.clipboard.writeText(summary);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied ✓" : "Copy full summary"}
      </button>
    </div>
  );
}

function HistoryPanel({
  address,
  history,
  loading,
  onClose,
  onRefresh,
}: {
  address: string | null;
  history: DeploymentRecord[] | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8">
      <div className="card-panel w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="text-base font-semibold">My Deployments</h3>
            {address && (
              <p className="text-xs text-muted-foreground font-mono">{truncate(address)}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-outline text-xs" onClick={onRefresh} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </button>
            <button className="btn-outline text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && (!history || history.length === 0) && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              You haven't deployed a DEX yet — head to Step 4 to ship one.
            </div>
          )}
          {history?.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {d.dexName}{" "}
                    <span className="font-mono text-xs text-muted-foreground">({d.dexSymbol})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(d.createdAt * 1000).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <ContractRows
                  rows={[
                    { label: "WETH", address: d.wethAddress },
                    { label: "Factory", address: d.factoryAddress },
                    { label: "Router", address: d.routerAddress },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PRESET_AMOUNTS = [5, 10, 25, 50];

function DonateModal({
  address,
  onClose,
}: {
  address: string | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number>(10);
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = custom ? Number(custom) : amount;
  const valid = Number.isFinite(effective) && effective > 0;

  async function donate() {
    setError(null);
    if (!valid) {
      setError("Enter a valid amount.");
      return;
    }
    setSending(true);
    try {
      if (!address) {
        await connectWallet();
      }
      await ensureBaseNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const usdc = new Contract(BASE_USDC, ERC20_TRANSFER_ABI, signer);
      const amountUnits = parseUnits(effective.toString(), BASE_USDC_DECIMALS);

      const bal: bigint = await usdc.balanceOf(await signer.getAddress());
      if (bal < amountUnits) {
        throw new Error("Insufficient USDC balance on Base.");
      }

      const tx = await usdc.transfer(DONATION_ADDRESS, amountUnits);
      toast.message("Sending donation…", { description: "Waiting for confirmation." });
      await tx.wait();
      toast.success("🎉 Thanks for your support!");
      onClose();
    } catch (e: any) {
      setError(decodeWalletError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card-panel w-full max-w-md p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Support this project</h3>
          <button className="btn-outline text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Donations help keep this tool running. Sent via USDC on Base.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {PRESET_AMOUNTS.map((a) => (
            <button
              key={a}
              onClick={() => {
                setAmount(a);
                setCustom("");
              }}
              className={`rounded-md border px-2 py-2 text-sm font-medium transition ${
                !custom && amount === a
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-border bg-white text-foreground hover:bg-[var(--muted)]"
              }`}
            >
              ${a}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Custom (USDC)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input-field mt-1"
            placeholder="e.g. 3.50"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
        <div className="mt-3 rounded-md border border-border bg-[var(--muted)] p-2 text-xs">
          To:{" "}
          <span className="font-mono">{truncate(DONATION_ADDRESS)}</span> · Base mainnet · USDC
        </div>
        {error && <ErrorLine msg={error} />}
        <button className="btn-primary mt-4 w-full" onClick={donate} disabled={sending || !valid}>
          {sending ? "Sending…" : `Donate $${valid ? effective : 0}`}
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Signed entirely by your wallet. Chain: Base ({BASE_CHAIN.chainIdHex}).
        </p>
      </div>
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <p className="mt-2 text-xs text-[var(--destructive)]">{msg}</p>;
}

function decodeWalletError(e: any): string {
  if (!e) return "Unknown error";
  if (e.code === 4001 || /user rejected|user denied/i.test(e?.message ?? "")) {
    return "You rejected the request in your wallet.";
  }
  if (/insufficient funds/i.test(e?.message ?? "")) {
    return "Insufficient funds for gas.";
  }
  if (/insufficient usdc|insufficient balance/i.test(e?.message ?? "")) {
    return "Insufficient USDC balance on Base.";
  }
  if (/network|timeout|failed to fetch/i.test(e?.message ?? "")) {
    return "Network / RPC error. Check your connection and retry.";
  }
  return e?.shortMessage ?? e?.message ?? "Something went wrong";
}

// keep unused import warning away
void getEthereum;
