import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WalletProvider } from "@/hooks/useWallet";
import { Navbar } from "@/components/Navbar";
import { SwapTab } from "@/components/SwapTab";
import { PoolTab } from "@/components/PoolTab";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIWA DEX: Swap and provide liquidity on GIWA Sepolia" },
      {
        name: "description",
        content:
          "Swap tokens and provide liquidity on GIWA Sepolia testnet. Non-custodial, wallet-signed transactions with daily check-in rewards.",
      },
      { property: "og:title", content: "GIWA DEX" },
      {
        property: "og:description",
        content:
          "Swap and provide liquidity on GIWA Sepolia. Non-custodial, wallet-signed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [tab, setTab] = useState<"swap" | "pool">("swap");
  return (
    <WalletProvider>
      <div className="min-h-screen">
        <Navbar tab={tab} setTab={setTab} />
        <main className="mx-auto max-w-6xl px-4 py-8">
          {tab === "swap" ? <SwapTab /> : <PoolTab />}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-muted-foreground">
          <p>Non-custodial. Your wallet signs everything. GIWA Sepolia Testnet.</p>
          <div className="mt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider">My Other Projects</div>
            <div className="flex flex-wrap justify-center gap-2">
              {["test-hub.xyz","litdex.test-hub.xyz","zkbet.test-hub.xyz","quipstats.test-hub.xyz"].map((d) => (
                <a
                  key={d}
                  href={`https://${d}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border bg-muted/40 px-3 py-1 hover:text-foreground"
                >
                  {d}
                </a>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </WalletProvider>
  );
}
