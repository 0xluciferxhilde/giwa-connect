import { toast } from "sonner";
import { txUrl } from "./giwa";

export function parseWalletError(e: any): string {
  const msg = (e?.shortMessage || e?.message || String(e)).toLowerCase();
  if (e?.code === 4001 || msg.includes("user rejected") || msg.includes("user denied"))
    return "Transaction rejected in wallet";
  if (msg.includes("insufficient funds")) return "Insufficient ETH for gas";
  if (msg.includes("insufficient_output_amount") || msg.includes("insufficient output"))
    return "Slippage too tight — try increasing tolerance";
  if (msg.includes("insufficient_liquidity") || msg.includes("insufficient liquidity"))
    return "Insufficient liquidity for this trade size";
  if (msg.includes("expired")) return "Transaction deadline expired";
  if (msg.includes("transfer_amount_exceeds_balance") || msg.includes("exceeds balance"))
    return "Insufficient token balance";
  if (msg.includes("allowance")) return "Insufficient allowance — approve first";
  return e?.shortMessage || e?.reason || e?.message || "Transaction failed";
}

export async function runTx(
  label: string,
  fn: () => Promise<{ hash: string; wait: () => Promise<any> }>,
): Promise<string | null> {
  const wait = toast.loading(`${label}: confirm in wallet…`);
  try {
    const tx = await fn();
    toast.loading(`${label}: pending…`, {
      id: wait,
      description: tx.hash,
    });
    await tx.wait();
    toast.success(`${label} confirmed`, {
      id: wait,
      description: tx.hash,
      action: {
        label: "View tx",
        onClick: () => window.open(txUrl(tx.hash), "_blank"),
      },
    });
    return tx.hash;
  } catch (e: any) {
    toast.error(parseWalletError(e), { id: wait });
    return null;
  }
}