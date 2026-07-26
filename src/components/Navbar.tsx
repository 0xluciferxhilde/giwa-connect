import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useWallet } from "@/lib/wallet-context";
import { truncate } from "@/lib/wallet";
import { dexApi, type TokensResp } from "@/lib/dex";
import { CheckInPill } from "./CheckInPill";
import { DonateModal } from "./DonateModal";

/**
 * Single shared app navbar. Owns its own full-width sticky container and inner
 * max-width, so its position is identical on every page regardless of that
 * page's own content width. Rendered once from src/routes/__root.tsx.
 */
export function Navbar() {
  const { address, connect, disconnect, connecting } = useWallet();
  const [donateOpen, setDonateOpen] = useState(false);
  const [tokens, setTokens] = useState<TokensResp | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    let alive = true;
    dexApi
      .tokens()
      .then((t) => alive && setTokens(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const linkBase =
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  const activeLink =
    "border-[var(--primary)] text-[var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]";
  const inactiveLink =
    "border-border text-muted-foreground hover:text-foreground hover:border-[var(--primary)]/40";

  const cls = (path: string) =>
    `${linkBase} ${pathname === path ? activeLink : inactiveLink}`;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
        <nav className="flex shrink-0 items-center gap-2">
          <Link to="/" className={cls("/")}>
            Deploy
          </Link>
          <Link to="/swap" className={cls("/swap")}>
            Swap
          </Link>
          <Link to="/pool" className={cls("/pool")}>
            Pool
          </Link>
        </nav>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <CheckInPill checkInAddress={tokens?.checkIn} />
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
      </div>
      {donateOpen && (
        <DonateModal address={address} onClose={() => setDonateOpen(false)} />
      )}
    </header>
  );
}
