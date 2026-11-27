import Link from "next/link";

/**
 * Renoflip's wordmark, in the design's manner: "reno" in a lighter green, "flip" in heavy deep green, and the full
 * stop in leaf green. `tone="light"` for a dark ground. `size` is the type size; the letters are drawn in tight.
 */
export function Wordmark({ size = "md", tone = "dark" }: { size?: "sm" | "md" | "lg"; tone?: "dark" | "light" }) {
  const px = { sm: "text-[24px]", md: "text-[31px]", lg: "text-[38px]" }[size];
  return (
    <span className={`font-extrabold leading-none tracking-[-0.07em] ${px}`}>
      <span className={tone === "light" ? "text-[#b7d39a]" : "text-[#5f8c6a]"}>reno</span>
      <span className={tone === "light" ? "text-white" : "text-ink-950"}>flip</span>
      <span className={tone === "light" ? "text-lime" : "text-brand-500"}>.</span>
    </span>
  );
}

export function Logo({ href = "/", size = "md", tone = "dark", className = "" }: { href?: string; size?: "sm" | "md" | "lg"; tone?: "dark" | "light"; className?: string }) {
  return (
    <Link href={href} aria-label="Renoflip home" className={`inline-flex items-center ${className}`}>
      <Wordmark size={size} tone={tone} />
    </Link>
  );
}
