import { createFileRoute } from "@tanstack/react-router";
import { DexWizard } from "@/components/DexWizard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GIWA DEX Deployer — Ship your own DEX on GIWA testnet" },
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
  return <DexWizard />;
}
