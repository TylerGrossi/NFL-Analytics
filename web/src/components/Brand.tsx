import Link from "next/link";
import { SITE } from "@/lib/site";

/**
 * The mark is four field hash marks at increasing heights — the ticks a play
 * starts from, which read as a bar chart. Drawn rather than set in type so it
 * holds up at 22px in the masthead and 40px anywhere else.
 */
export function BrandMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="1" y="13" width="3.6" height="10" rx="0.8" fill="currentColor" opacity="0.55" />
      <rect x="7.1" y="9" width="3.6" height="14" rx="0.8" fill="currentColor" opacity="0.72" />
      <rect x="13.2" y="5" width="3.6" height="18" rx="0.8" fill="currentColor" opacity="0.86" />
      <rect x="19.3" y="1" width="3.6" height="22" rx="0.8" fill="currentColor" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 shrink-0 text-white no-underline group"
      aria-label={`${SITE.name} home`}
    >
      <BrandMark size={22} className="text-white/90 group-hover:text-white transition-colors" />
      <span className="headline text-[19px] tracking-[-0.02em] leading-none pt-px">
        {SITE.name}
      </span>
    </Link>
  );
}
