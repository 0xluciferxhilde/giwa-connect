import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Contract } from "ethers";
import { CHECKIN_ABI, decodeWalletError, explorerTx, fmtUnits } from "@/lib/dex";
import { ensureGiwaNetwork, getProvider } from "@/lib/wallet";
import { useWallet } from "@/lib/wallet-context";

export function CheckInPill({ checkInAddress }: { checkInAddress?: string }) {
  const { address, bumpRefresh, refreshTick } = useWallet();
  const [canCheckIn, setCanCheckIn] = useState<boolean | null>(null);
  const [streak, setStreak] = useState<bigint>(0n);
  const [reward, setReward] = useState<bigint>(0n);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Reads the on-chain state and returns the freshly read streak (or null).
  const refresh = useCallback(async (): Promise<bigint | null> => {
    if (!address || !checkInAddress) return null;
    try {
      const provider = await getProvider();
      const c = new Contract(checkInAddress, CHECKIN_ABI, provider);
      const results = await Promise.allSettled([
        c.canCheckIn(address),
        c.streaks(address),
        c.getReward(address),
      ]);
      if (results[0].status === "fulfilled") setCanCheckIn(Boolean(results[0].value));
      let fresh: bigint | null = null;
      if (results[1].status === "fulfilled") {
        fresh = BigInt(results[1].value);
        setStreak(fresh);
      }
      if (results[2].status === "fulfilled") setReward(BigInt(results[2].value));
      return fresh;
    } catch (e) {
      console.error("check-in refresh failed", e);
      setCanCheckIn(null);
      return null;
    }
  }, [address, checkInAddress]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTick]);

  const doCheckIn = async () => {
    if (!address || !checkInAddress) return;
    setPending(true);
    const prevStreak = streak;
    try {
      await ensureGiwaNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const c = new Contract(checkInAddress, CHECKIN_ABI, signer);
      const tx = await c.checkIn();
      toast.message("Check-in submitted", { description: "Waiting for confirmation." });
      const receipt = await tx.wait();
      toast.success("Checked in ✓", {
        description: reward > 0n ? `+${fmtUnits(reward, 18, 2)} GDEX` : "Reward claimed",
        action: receipt?.hash
          ? { label: "View", onClick: () => window.open(explorerTx(receipt.hash), "_blank") }
          : undefined,
      });
      bumpRefresh();
      // Re-read the streak straight from the contract. Some RPC nodes lag a
      // block behind the receipt, so poll briefly until the value moves.
      for (let i = 0; i < 8; i++) {
        const fresh = await refresh();
        if (fresh !== null && fresh > prevStreak) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e: any) {
      toast.error(decodeWalletError(e));
    } finally {
      setPending(false);
    }
  };

  if (!address) return null;
  if (canCheckIn === null) {
    return (
      <span className="rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground">
        Check-in…
      </span>
    );
  }

  const streakBadge = (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-xs font-mono">
      🔥 {streak.toString()}
    </span>
  );

  if (canCheckIn) {
    const rewardTxt = reward > 0n ? `+${fmtUnits(reward, 18, 0)} GDEX` : "+100 GDEX";
    return (
      <span className="flex items-center gap-2">
        {streakBadge}
        <button
          disabled={pending}
          onClick={doCheckIn}
          className="rounded-full border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Checking in…" : `Check In (${rewardTxt})`}
        </button>
      </span>
    );
  }

  // Next UTC midnight from current time (00:00 UTC = 05:30 IST)
  const d = new Date(now);
  const nextResetMs = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
  );
  const remaining = Math.max(0, nextResetMs - now);
  const hh = Math.floor(remaining / 3_600_000)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((remaining % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor((remaining % 60_000) / 1000)
    .toString()
    .padStart(2, "0");
  return (
    <span className="flex items-center gap-2">
      {streakBadge}
      <span className="rounded-full border border-border bg-[var(--muted)] px-3 py-1 text-xs text-muted-foreground">
        Checked In ✓ · {hh}:{mm}:{ss}
      </span>
    </span>
  );
}