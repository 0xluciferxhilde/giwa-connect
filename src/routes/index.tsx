import { createFileRoute } from "@tanstack/react-router";
import { DexWizard } from "@/components/DexWizard";
import { Navbar } from "@/components/Navbar";
import { CheckInPill } from "@/components/CheckInPill";
import { useEffect, useState } from "react";
import { dexApi, type TokensResp } from "@/lib/dex";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIWA DEX Deployer: Ship your own DEX on GIWA testnet" },
      {
        name: "description",
        content:
          "Deploy your own DEX (WETH, Factory, Router) to the GIWA testnet from your wallet in four guided steps. No keys, no accounts, no backend.",
      },
      { property: "og:title", content: "GIWA DEX Deployer" },
      {
        property: "og:description",
        content:
          "Deploy WETH + Factory + Router to GIWA testnet directly from your wallet in 4 steps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [tokens, setTokens] = useState<TokensResp | null>(null);
  useEffect(() => {
    let alive = true;
    dexApi.tokens().then((t) => alive && setTokens(t)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div>
      <div className="mx-auto w-full max-w-5xl px-4 pt-6">
        <Navbar active="deployer" rightExtras={<CheckInPill checkInAddress={tokens?.checkIn} />} />
      </div>
      <DexWizard />
    </div>
  );
}
