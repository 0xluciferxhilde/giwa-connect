import { createFileRoute } from "@tanstack/react-router";
import { SwapPage } from "@/components/SwapPage";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Swap — GIWA DEX" },
      {
        name: "description",
        content:
          "Swap GIWA, GDEX, USDT and USDC on the GIWA Sepolia testnet directly from your wallet.",
      },
      { property: "og:title", content: "Swap on GIWA DEX" },
      {
        property: "og:description",
        content: "Trade tokens on GIWA Sepolia testnet directly from your wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SwapPage,
});