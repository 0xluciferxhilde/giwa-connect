import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectWallet as connectRaw,
  ensureGiwaNetwork,
  getCurrentChainIdHex,
} from "./wallet";
import { GIWA_CHAIN } from "./giwa";

type Ctx = {
  address: string | null;
  chainIdHex: string | null;
  onGiwa: boolean;
  connecting: boolean;
  connectError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  setAddress: (a: string | null) => void;
  refreshTick: number;
  bumpRefresh: () => void;
};

const WalletCtx = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainIdHex, setChainIdHex] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [refreshTick, setTick] = useState(0);

  const bumpRefresh = useCallback(() => setTick((t) => t + 1), []);

  const connect = useCallback(async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const a = await connectRaw();
      await ensureGiwaNetwork();
      setAddress(a);
      setChainIdHex(await getCurrentChainIdHex());
    } catch (e: any) {
      setConnectError(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  useEffect(() => {
    getCurrentChainIdHex().then(setChainIdHex).catch(() => {});
    if (typeof window === "undefined") return;
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => {
      const next = accs?.[0] ?? null;
      setAddress(next);
      bumpRefresh();
    };
    const onChain = (cid: string) => {
      setChainIdHex(cid);
      bumpRefresh();
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [bumpRefresh]);

  const onGiwa =
    chainIdHex?.toLowerCase() === GIWA_CHAIN.chainIdHex.toLowerCase();

  const value = useMemo<Ctx>(
    () => ({
      address,
      chainIdHex,
      onGiwa,
      connecting,
      connectError,
      connect,
      disconnect,
      setAddress,
      refreshTick,
      bumpRefresh,
    }),
    [
      address,
      chainIdHex,
      onGiwa,
      connecting,
      connectError,
      connect,
      disconnect,
      refreshTick,
      bumpRefresh,
    ],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet must be used within WalletProvider");
  return c;
}