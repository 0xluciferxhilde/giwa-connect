import { useEffect } from "react";

export function SuccessDialog({
  open,
  title,
  description,
  txHash,
  explorerUrl,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  txHash?: string;
  explorerUrl?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
          {explorerUrl && txHash && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 text-xs font-mono text-muted-foreground underline underline-offset-2 hover:text-foreground break-all"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
          )}
          <button
            onClick={onClose}
            className="btn-primary mt-5 w-full text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}