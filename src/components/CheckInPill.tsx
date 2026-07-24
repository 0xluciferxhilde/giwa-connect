import { useEffect, useState } from "react";
import { Contract, formatUnits } from "ethers";
import { Flame, CheckCircle2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useTokens } from "@/hooks/useDex";
import { CHECKIN_ABI } from "@/lib/abis";
import { runTx } from "@/lib/tx";

export function CheckInPill() {
  const { address, provider, getSigner, bumpRefresh, refreshTick, isCorrectChain } = useWallet();
  const { data: tokens } = useTokens();
  const [streak, setStreak] = useState(0);
  const [canCheckIn, setCan] = useState(false);
  const [nextIn, setNextIn] = useState<number>(0); // seconds
  const [loading, setLoading] = useState(false);

  const checkInAddr = tokens?.checkIn;

  useEffect(() => {
    if (!address || !provider || !checkInAddr || !isCorrectChain) return;
    let cancel = false;
    (async () => {
      try {
        const c = new Contract(checkInAddr, CHECKIN_ABI, provider);
        let streakNum = 0;
        let lastTs = 0;
        try {
          const info = await c.getUserInfo(address);
          lastTs = Number(info[0]);
          streakNum = Number(info[1]);
        } catch {}
        let can = true;
        try {
          can = await c.canCheckIn(address);
        } catch {
          // fall back to 24h since last
          const now = Math.floor(Date.now() / 1000);
          can = now - lastTs >= 24 * 3600;
        }
        if (cancel) return;
        setStreak(streakNum);
        setCan(can);
        if (!can && lastTs > 0) {
          const now = Math.floor(Date.now() / 1000);
          setNextIn(Math.max(0, 24 * 3600 - (now - lastTs)));
        } else {
          setNextIn(0);
        }
      } catch {}
    })();
    return () => {
      cancel = true;
    };
  }, [address, provider, checkInAddr, refreshTick, isCorrectChain]);

  // countdown
  useEffect(() => {
    if (nextIn <= 0) return;
    const id = setInterval(() => setNextIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [nextIn]);

  const handleCheckIn = async () => {
    if (!checkInAddr) return;
    setLoading(true);
    try {
      const signer = await getSigner();
      const c = new Contract(checkInAddr, CHECKIN_ABI, signer);
      const hash = await runTx("Daily check-in", () => c.checkIn());
      if (hash) bumpRefresh();
    } finally {
      setLoading(false);
    }
  };

  const rewardLabel = streak + 1 === 7 ? "+10,100 GDEX" : "+100 GDEX";
  const countdown = formatCountdown(nextIn);

  return (
    <div className="flex items-center gap-2">
      {streak > 0 && (
        <div className="hidden items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold sm:flex">
          <Flame className="h-3.5 w-3.5 text-orange-400" />
          {streak}
        </div>
      )}
      {canCheckIn ? (
        <button
          onClick={handleCheckIn}
          disabled={loading}
          className="rounded-full bg-gradient-to-r from-primary to-accent px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-[0_0_20px_rgba(139,92,246,0.5)] disabled:opacity-60"
        >
          Check In ({rewardLabel})
        </button>
      ) : (
        <div className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span className="hidden sm:inline">Checked In</span>
          {countdown && <span className="font-mono">· {countdown}</span>}
        </div>
      )}
    </div>
  );
}

function formatCountdown(s: number): string {
  if (s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}