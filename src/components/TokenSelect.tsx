import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { TokenInfo } from "@/lib/giwa";

export function TokenSelect({
  value,
  tokens,
  onChange,
  disabledSymbol,
}: {
  value: TokenInfo;
  tokens: TokenInfo[];
  onChange: (t: TokenInfo) => void;
  disabledSymbol?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold hover:bg-border"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-primary/40 to-accent/40 text-[10px] font-bold">
          {value.symbol.slice(0, 2)}
        </span>
        {value.symbol}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            {tokens.map((t) => (
              <button
                key={t.address}
                disabled={t.symbol === disabledSymbol}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-primary/40 to-accent/40 text-[10px] font-bold">
                  {t.symbol.slice(0, 2)}
                </span>
                {t.symbol}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}