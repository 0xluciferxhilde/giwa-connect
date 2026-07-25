import { createFileRoute } from "@tanstack/react-router";
import { PoolPage } from "@/components/PoolPage";

export const Route = createFileRoute("/pool")({
  head: () => ({
    meta: [
      { title: "Pool — GIWA DEX" },
      {
        name: "description",
        content:
          "Provide liquidity to GIWA DEX pools on GIWA Sepolia testnet from your wallet.",
      },
      { property: "og:title", content: "Liquidity Pools on GIWA DEX" },
      {
        property: "og:description",
        content: "Add and manage liquidity on GIWA Sepolia testnet from your wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PoolPage,
});