import { TOKEN_LOGOS } from "@/lib/dex";

export function TokenIcon({
  symbol,
  size = 24,
  className = "",
}: {
  symbol?: string;
  size?: number;
  className?: string;
}) {
  const key = (symbol ?? "").toUpperCase();
  const src = TOKEN_LOGOS[key];
  if (!src) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-[var(--muted)] text-[10px] font-semibold text-muted-foreground ${className}`}
        style={{ width: size, height: size }}
      >
        {key.slice(0, 3)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={key}
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}