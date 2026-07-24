import { useState } from "react";
import { Wallet } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { truncate } from "@/lib/wallet";
import { CheckInPill } from "./CheckInPill";

export function Navbar({
  tab,
  setTab,
}: {
  tab: "swap" | "pool";
  setTab: (t: "swap" | "pool") => void;
}) {
  const { address, ethBalance, connect, isCorrectChain, switchNetwork } = useWallet();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <img src="/giwa-logo.png" alt="" className="h-7 w-7" />
            <span className="text-lg font-bold tracking-tight">
              GIWA <span className="text-primary">DEX</span>
            </span>
          </div>
          <nav className="hidden gap-1 rounded-full bg-muted p-1 sm:flex">
            {(["swap", "pool"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {address && isCorrectChain && <CheckInPill />}
          {address ? (
            isCorrectChain ? (
              <div className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm sm:flex">
                <span className="text-muted-foreground">
                  {Number(ethBalance).toFixed(4)} ETH
                </span>
                <span className="h-4 w-px bg-border" />
                <span className="font-mono text-xs">{truncate(address)}</span>
              </div>
            ) : (
              <button
                onClick={switchNetwork}
                className="rounded-full bg-warning px-3 py-1.5 text-xs font-semibold text-background"
              >
                Switch to GIWA
              </button>
            )
          ) : (
            <button
              onClick={connect}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Wallet className="h-4 w-4" /> Connect
            </button>
          )}
        </div>
      </div>
      {/* mobile tabs */}
      <nav className="flex gap-1 border-t border-border p-2 sm:hidden">
        {(["swap", "pool"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
    </header>
  );
}