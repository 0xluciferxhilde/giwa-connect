import { useEffect, useMemo, useState } from "react";
import { ContractFactory, type BrowserProvider, type JsonRpcSigner } from "ethers";
import {
  api,
  EXPLORER,
  type BalanceResp,
  type DeployInfoResp,
  type FaucetsResp,
  type PoolNameResp,
} from "@/lib/giwa";
import { connectWallet, ensureGiwaNetwork, getProvider, truncate } from "@/lib/wallet";

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

export function DexWizard() {
  const [step, setStep] = useState(1);
  const [address, setAddress] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // step 2
  const [faucets, setFaucets] = useState<FaucetsResp | null>(null);

  // step 3
  const [balance, setBalance] = useState<BalanceResp | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // step 4
  const [pool, setPool] = useState<PoolNameResp | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfoResp | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([
    { key: "weth", label: "Deploy WETH", status: "idle" },
    { key: "factory", label: "Deploy Factory", status: "idle" },
    { key: "router", label: "Deploy Router", status: "idle" },
  ]);
  const [deploying, setDeploying] = useState(false);

  // Load faucets when step 2 opens
  useEffect(() => {
    if (step >= 2 && !faucets) {
      api.faucets().then(setFaucets).catch(() => {});
    }
  }, [step, faucets]);

  // Load pool + deploy info when step 4 opens
  useEffect(() => {
    if (step !== 4 || pool) return;
    (async () => {
      try {
        const p = await api.poolName();
        setPool(p);
        const info = await api.deployInfo(p.name, p.symbol);
        setDeployInfo(info);
      } catch (e: any) {
        setPrepError(e?.message ?? "Failed to load deploy info");
      }
    })();
  }, [step, pool]);

  // Wallet account change tracking
  useEffect(() => {
    const eth = (typeof window !== "undefined" ? window.ethereum : undefined);
    if (!eth?.on) return;
    const handler = (accs: string[]) => setAddress(accs[0] ?? null);
    eth.on("accountsChanged", handler);
    return () => eth.removeListener?.("accountsChanged", handler);
  }, []);

  async function handleConnect() {
    setConnectError(null);
    setConnecting(true);
    try {
      const a = await connectWallet();
      await ensureGiwaNetwork();
      setAddress(a);
      setStep((s) => Math.max(s, 2));
    } catch (e: any) {
      setConnectError(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function refreshBalance() {
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
  }

  useEffect(() => {
    if (step === 3 && address && !balance) refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, address]);

  function updateDeployStep(key: DeployStep["key"], patch: Partial<DeployStep>) {
    setDeploySteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function runDeploy() {
    if (!deployInfo || !address) return;
    setDeploying(true);
    try {
      await ensureGiwaNetwork();
      const provider: BrowserProvider = await getProvider();
      const signer: JsonRpcSigner = await provider.getSigner();

      // 1) WETH
      updateDeployStep("weth", { status: "awaiting", error: undefined });
      const wethFactory = new ContractFactory(
        deployInfo.weth.abi,
        deployInfo.weth.bytecode,
        signer,
      );
      const weth = await wethFactory.deploy();
      const wethTx = weth.deploymentTransaction();
      updateDeployStep("weth", { status: "confirming", txHash: wethTx?.hash });
      await weth.waitForDeployment();
      const wethAddr = await weth.getAddress();
      updateDeployStep("weth", { status: "done", address: wethAddr });

      // 2) Factory (name, feeToSetter)
      updateDeployStep("factory", { status: "awaiting" });
      const factoryFactory = new ContractFactory(
        deployInfo.factory.abi,
        deployInfo.factory.bytecode,
        signer,
      );
      const factory = await factoryFactory.deploy(deployInfo.dexName, address);
      const facTx = factory.deploymentTransaction();
      updateDeployStep("factory", { status: "confirming", txHash: facTx?.hash });
      await factory.waitForDeployment();
      const factoryAddr = await factory.getAddress();
      updateDeployStep("factory", { status: "done", address: factoryAddr });

      // 3) Router (factory, weth)
      updateDeployStep("router", { status: "awaiting" });
      const routerFactory = new ContractFactory(
        deployInfo.router.abi,
        deployInfo.router.bytecode,
        signer,
      );
      const router = await routerFactory.deploy(factoryAddr, wethAddr);
      const rTx = router.deploymentTransaction();
      updateDeployStep("router", { status: "confirming", txHash: rTx?.hash });
      await router.waitForDeployment();
      const routerAddr = await router.getAddress();
      updateDeployStep("router", { status: "done", address: routerAddr });
    } catch (e: any) {
      const msg = decodeWalletError(e);
      // Mark the current in-progress step as errored
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

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <Header />
      <ProgressBar current={step} />

      <div className="mt-8 space-y-6">
        <StepCard n={1} title={STEPS[0]} active={step === 1} done={step > 1}>
          <p className="text-sm text-muted-foreground">
            MetaMask popup — you approve, we only ever see your public address.
          </p>
          {address ? (
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
              <span className="font-mono text-sm">{truncate(address)}</span>
              <span className="text-xs text-muted-foreground">connected · GIWA testnet</span>
            </div>
          ) : (
            <div className="mt-4">
              <button
                className="btn-primary"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : "Connect Wallet"}
              </button>
              {connectError && <ErrorLine msg={connectError} />}
            </div>
          )}
        </StepCard>

        <StepCard n={2} title={STEPS[1]} active={step === 2} done={step > 2} locked={step < 2}>
          <p className="text-sm text-muted-foreground">
            We check your balance and link out to faucets. Claiming happens on their site, in your
            wallet.
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
          <div className="mt-5 rounded-lg border border-border bg-[var(--muted)]/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  GIWA balance
                </div>
                <div className="mt-1 font-mono text-lg">
                  {balance ? `${balance.balanceEth} ETH` : balanceLoading ? "…" : "—"}
                </div>
              </div>
              <button className="btn-outline text-sm" onClick={refreshBalance} disabled={balanceLoading}>
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
          {prepError && <ErrorLine msg={prepError} />}
          {pool && (
            <div className="rounded-lg border border-border bg-[var(--muted)]/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                You're deploying
              </div>
              <div className="mt-1 text-xl font-semibold">
                {pool.name}{" "}
                <span className="text-muted-foreground font-mono text-base">({pool.symbol})</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Name is assigned per session so no two deployments share branding.
              </div>
            </div>
          )}

          <p className="mt-4 text-sm text-muted-foreground">
            3 signatures — WETH, Factory, Router. Each one you approve individually.
          </p>

          <div className="mt-4 space-y-2">
            {deploySteps.map((s, i) => (
              <DeployRow key={s.key} index={i + 1} step={s} />
            ))}
          </div>

          {!allDone && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                onClick={runDeploy}
                disabled={!deployInfo || deploying}
              >
                {deploying
                  ? "Deploying…"
                  : deploySteps.some((s) => s.status === "error")
                    ? "Retry deployment"
                    : "Start deployment"}
              </button>
            </div>
          )}

          {allDone && <SuccessSummary steps={deploySteps} />}
        </StepCard>
      </div>

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Stateless. No accounts. No keys. Your wallet signs everything.
      </footer>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-8 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--card)]/60 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
        GIWA Testnet · chain 91342
      </div>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">GIWA DEX Deployer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ship your own DEX — WETH, Factory, Router — from your wallet, in 4 steps.
      </p>
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
                    ? "bg-[var(--card)] border border-[var(--primary)] text-foreground"
                    : "bg-[var(--muted)] text-muted-foreground"
              }`}
            >
              {done ? "✓" : n}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 ${done ? "bg-[var(--primary)]" : "bg-border"}`}
              />
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
        {done && (
          <span className="text-xs font-medium text-[var(--success)]">Complete</span>
        )}
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
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-[var(--muted)]/30 p-3">
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

function SuccessSummary({ steps }: { steps: DeployStep[] }) {
  const [weth, factory, router] = steps;
  const summary = useMemo(
    () =>
      `WETH:    ${weth.address}\nFactory: ${factory.address}\nRouter:  ${router.address}\nExplorer: ${EXPLORER}/address/${router.address}`,
    [weth.address, factory.address, router.address],
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-5 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-4">
      <div className="text-sm font-semibold text-[var(--primary)]">
        🎉 Your DEX is live on GIWA testnet
      </div>
      <pre className="mt-3 overflow-x-auto rounded-md bg-black/40 p-3 font-mono text-xs leading-6">
        {summary}
      </pre>
      <button
        className="btn-outline mt-3 text-xs"
        onClick={async () => {
          await navigator.clipboard.writeText(summary);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied ✓" : "Copy summary"}
      </button>
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <p className="mt-2 text-xs text-[var(--destructive)]">
      {msg}
    </p>
  );
}

function decodeWalletError(e: any): string {
  if (!e) return "Unknown error";
  if (e.code === 4001 || /user rejected|user denied/i.test(e?.message ?? "")) {
    return "You rejected the signature in your wallet.";
  }
  if (/insufficient funds/i.test(e?.message ?? "")) {
    return "Insufficient GIWA testnet ETH for gas. Bridge more and retry.";
  }
  if (/network|timeout|failed to fetch/i.test(e?.message ?? "")) {
    return "Network / RPC timeout. Check your connection and retry.";
  }
  return e?.shortMessage ?? e?.message ?? "Deployment failed";
}
