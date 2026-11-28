import Link from "next/link";

/**
 * RenoFlip's mark, from the design of 2026-11-27: an orange rounded square with an ink roof over an ink F. Drawn in
 * code (no image to load), the same as app/icon.svg and public/brand/renoflip-mark.svg.
 */
export function Mark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={`shrink-0 ${className}`}>
      <rect width="48" height="48" rx="13" fill="#ff6a3d" />
      <path d="M9 23 24 10l15 13" fill="none" stroke="#101820" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 23h15v5H23v4h8v5h-8v6h-5z" fill="#101820" />
    </svg>
  );
}

/** "RenoFlip": Reno in ink (white on a dark ground), Flip in orange, set tight. */
export function Wordmark({ size = "md", tone = "dark" }: { size?: "sm" | "md" | "lg"; tone?: "dark" | "light" }) {
  const px = { sm: "text-[21px]", md: "text-[26px]", lg: "text-[34px]" }[size];
  return (
    <span className={`font-extrabold leading-none tracking-[-0.065em] ${px}`}>
      <span className={tone === "light" ? "text-white" : "text-ink-950"}>Reno</span>
      <span className="text-orange">Flip</span>
    </span>
  );
}

export function Logo({ href = "/", size = "md", tone = "dark", mark = true, className = "" }: { href?: string; size?: "sm" | "md" | "lg"; tone?: "dark" | "light"; mark?: boolean; className?: string }) {
  const markSize = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-10 w-10" }[size];
  return (
    <Link href={href} aria-label="RenoFlip home" className={`inline-flex items-center gap-2.5 ${className}`}>
      {mark && <Mark className={markSize} />}
      <Wordmark size={size} tone={tone} />
    </Link>
  );
}
