import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useWallet } from "@/lib/wallet-context";
import { truncate } from "@/lib/wallet";
import { DonateModal } from "./DonateModal";

export function Navbar({
  active,
  rightExtras,
}: {
  active?: "swap" | "pool" | "deployer";
  rightExtras?: ReactNode;
}) {
  const { address, connect, disconnect, connecting } = useWallet();
  const [donateOpen, setDonateOpen] = useState(false);

  const linkBase =
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  const activeLink =
    "border-[var(--primary)] text-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]";
  const inactiveLink =
    "border-border text-muted-foreground hover:text-foreground hover:border-[var(--primary)]/40";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <nav className="flex items-center gap-2">
        <Link
          to="/"
          className={`${linkBase} ${active === "deployer" ? activeLink : inactiveLink}`}
        >
          Deploy
        </Link>
        <Link
          to="/swap"
          className={`${linkBase} ${active === "swap" ? activeLink : inactiveLink}`}
        >
          Swap
        </Link>
        <Link
          to="/pool"
          className={`${linkBase} ${active === "pool" ? activeLink : inactiveLink}`}
        >
          Pool
        </Link>
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {rightExtras}
        {address ? (
          <>
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-mono">
              {truncate(address)}
            </span>
            <button className="btn-outline text-xs" onClick={disconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="btn-outline text-xs"
            onClick={() => connect()}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
        <button
          className="rounded-full border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90"
          onClick={() => setDonateOpen(true)}
        >
          ♥ Donate
        </button>
      </div>
      {donateOpen && (
        <DonateModal address={address} onClose={() => setDonateOpen(false)} />
      )}
    </div>
  );
}