import { BrowserProvider, type Eip1193Provider } from "ethers";
import { GIWA_CHAIN } from "./giwa";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      request: (a: { method: string; params?: any[] }) => Promise<any>;
      on?: (event: string, cb: (...args: any[]) => void) => void;
      removeListener?: (event: string, cb: (...args: any[]) => void) => void;
    };
  }
}

export function getEthereum() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected. Install MetaMask or use a wallet browser.");
  }
  return window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const eth = getEthereum();
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("No account returned by wallet.");
  return accounts[0];
}

export async function ensureGiwaNetwork(): Promise<void> {
  const eth = getEthereum();
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: GIWA_CHAIN.chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902 || /Unrecognized chain/i.test(err?.message ?? "")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: GIWA_CHAIN.chainIdHex,
            chainName: GIWA_CHAIN.chainName,
            rpcUrls: GIWA_CHAIN.rpcUrls,
            blockExplorerUrls: GIWA_CHAIN.blockExplorerUrls,
            nativeCurrency: GIWA_CHAIN.nativeCurrency,
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function getProvider() {
  return new BrowserProvider(getEthereum() as any);
}

export function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
