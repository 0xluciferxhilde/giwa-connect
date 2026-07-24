import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BrowserProvider, formatEther, type JsonRpcSigner } from "ethers";
import { toast } from "sonner";
import { GIWA_CHAIN } from "@/lib/giwa";
import { connectWallet, ensureGiwaNetwork, getEthereum } from "@/lib/wallet";

type WalletCtx = {
  address: string | null;
  chainIdHex: string | null;
  isCorrectChain: boolean;
  ethBalance: string;
  provider: BrowserProvider | null;
  getSigner: () => Promise<JsonRpcSigner>;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  refreshEth: () => Promise<void>;
  refreshTick: number; // increments after tx confirmation
  bumpRefresh: () => void;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainIdHex, setChainIdHex] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [refreshTick, setTick] = useState(0);
  const bumpRefresh = useCallback(() => setTick((t) => t + 1), []);

  const provider = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    return new BrowserProvider(window.ethereum as any);
  }, [address, chainIdHex]);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet detected");
    const p = new BrowserProvider(window.ethereum as any);
    return p.getSigner();
  }, []);

  const refreshEth = useCallback(async () => {
    if (!address || !provider) return;
    try {
      const bal = await provider.getBalance(address);
      setEthBalance(formatEther(bal));
    } catch {}
  }, [address, provider]);

  const connect = useCallback(async () => {
    try {
      const addr = await connectWallet();
      setAddress(addr);
      await ensureGiwaNetwork();
      const eth = getEthereum();
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setChainIdHex(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to connect");
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    try {
      await ensureGiwaNetwork();
      const eth = getEthereum();
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setChainIdHex(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to switch network");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;
    // check existing
    (async () => {
      try {
        const accts = (await eth.request({ method: "eth_accounts" })) as string[];
        if (accts?.[0]) setAddress(accts[0]);
        const id = (await eth.request({ method: "eth_chainId" })) as string;
        setChainIdHex(id);
      } catch {}
    })();
    const onAcc = (accs: string[]) => setAddress(accs?.[0] ?? null);
    const onChain = (id: string) => setChainIdHex(id);
    eth.on?.("accountsChanged", onAcc);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    refreshEth();
  }, [refreshEth, refreshTick]);

  const isCorrectChain =
    !!chainIdHex && chainIdHex.toLowerCase() === GIWA_CHAIN.chainIdHex.toLowerCase();

  return (
    <Ctx.Provider
      value={{
        address,
        chainIdHex,
        isCorrectChain,
        ethBalance,
        provider,
        getSigner,
        connect,
        switchNetwork,
        refreshEth,
        refreshTick,
        bumpRefresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}