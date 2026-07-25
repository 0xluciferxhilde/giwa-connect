import { useState } from "react";
import { toast } from "sonner";
import { Contract, parseUnits } from "ethers";
import {
  BASE_CHAIN,
  BASE_USDC,
  BASE_USDC_DECIMALS,
  DONATION_ADDRESS,
} from "@/lib/giwa";
import {
  connectWallet,
  ensureBaseNetwork,
  getProvider,
  truncate,
} from "@/lib/wallet";
import { decodeWalletError } from "@/lib/dex";

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
];

const PRESET_AMOUNTS = [5, 10, 25, 50];

export function DonateModal({
  address,
  onClose,
}: {
  address: string | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number>(10);
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = custom ? Number(custom) : amount;
  const valid = Number.isFinite(effective) && effective > 0;

  async function donate() {
    setError(null);
    if (!valid) {
      setError("Enter a valid amount.");
      return;
    }
    setSending(true);
    try {
      if (!address) await connectWallet();
      await ensureBaseNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const usdc = new Contract(BASE_USDC, ERC20_TRANSFER_ABI, signer);
      const amountUnits = parseUnits(effective.toString(), BASE_USDC_DECIMALS);
      const bal: bigint = await usdc.balanceOf(await signer.getAddress());
      if (bal < amountUnits) throw new Error("Insufficient USDC balance on Base.");
      const tx = await usdc.transfer(DONATION_ADDRESS, amountUnits);
      toast.message("Sending donation…", { description: "Waiting for confirmation." });
      await tx.wait();
      toast.success("🎉 Thanks for your support!");
      onClose();
    } catch (e: any) {
      setError(decodeWalletError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card-panel w-full max-w-md p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Support this project</h3>
          <button className="btn-outline text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Donations help keep this tool running. Sent via USDC on Base.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {PRESET_AMOUNTS.map((a) => (
            <button
              key={a}
              onClick={() => {
                setAmount(a);
                setCustom("");
              }}
              className={`rounded-md border px-2 py-2 text-sm font-medium transition ${
                !custom && amount === a
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-border bg-white text-foreground hover:bg-[var(--muted)]"
              }`}
            >
              ${a}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Custom (USDC)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input-field mt-1"
            placeholder="e.g. 3.50"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
        <div className="mt-3 rounded-md border border-border bg-[var(--muted)] p-2 text-xs">
          To: <span className="font-mono">{truncate(DONATION_ADDRESS)}</span> · Base mainnet · USDC
        </div>
        {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
        <button
          className="btn-primary mt-4 w-full"
          onClick={donate}
          disabled={sending || !valid}
        >
          {sending ? "Sending…" : `Donate $${valid ? effective : 0}`}
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Signed entirely by your wallet. Chain: Base ({BASE_CHAIN.chainIdHex}).
        </p>
      </div>
    </div>
  );
}