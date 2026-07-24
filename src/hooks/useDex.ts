import { useQuery } from "@tanstack/react-query";
import { Contract, formatUnits } from "ethers";
import { api, FALLBACK_TOKENS, type TokenInfo } from "@/lib/giwa";
import { ERC20_ABI } from "@/lib/abis";
import { useWallet } from "./useWallet";

export function useTokens() {
  return useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      try {
        return await api.tokens();
      } catch {
        // fallback to hardcoded if API unreachable
        return {
          tokens: FALLBACK_TOKENS,
          router: "0x070bd877F573Ea66E24c140876E07558b970B404",
          factory: "0x9992053d3F24B4a67542bdF74A1cA4D8422f9206",
          checkIn: "0xa1b4Db18Fe0903e407FFeD9A7f3CA8B7FfaC052D",
          gdexToken: "0x02b8b8090dFFb61dE134A9e639577E9c153Ac871",
        };
      }
    },
    staleTime: 60_000,
  });
}

export function usePools() {
  const { refreshTick } = useWallet();
  return useQuery({
    queryKey: ["pools", refreshTick],
    queryFn: () => api.pools(),
    staleTime: 10_000,
  });
}

export function useUserPools() {
  const { address, refreshTick, isCorrectChain } = useWallet();
  return useQuery({
    queryKey: ["userPools", address, refreshTick],
    queryFn: () => api.userPools(address!),
    enabled: !!address && isCorrectChain,
    staleTime: 5_000,
  });
}

export type BalanceMap = Record<string, string>; // symbol -> human string

export function useBalances(tokens: TokenInfo[] | undefined) {
  const { address, provider, refreshTick, isCorrectChain, ethBalance } = useWallet();
  return useQuery({
    queryKey: [
      "balances",
      address,
      refreshTick,
      tokens?.map((t) => t.address).join(","),
      ethBalance,
    ],
    queryFn: async (): Promise<BalanceMap> => {
      if (!address || !provider || !tokens) return {};
      const out: BalanceMap = {};
      // GIWA (native) uses ethBalance already
      out["GIWA"] = ethBalance;
      await Promise.all(
        tokens
          .filter((t) => t.symbol !== "GIWA" && t.symbol !== "WETH")
          .map(async (t) => {
            try {
              const c = new Contract(t.address, ERC20_ABI, provider);
              const b: bigint = await c.balanceOf(address);
              out[t.symbol] = formatUnits(b, t.decimals);
            } catch {
              out[t.symbol] = "0";
            }
          }),
      );
      return out;
    },
    enabled: !!address && !!provider && !!tokens && isCorrectChain,
    staleTime: 5_000,
  });
}