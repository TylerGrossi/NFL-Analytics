import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/site";

/**
 * The mark: a football rising out of a bar chart.
 *
 * Two files, because the masthead is navy and the artwork is dark. `mark.png`
 * is the original — navy on transparent, for light surfaces. `mark-light.png`
 * is a knockout of the same shape, so on the navy header the ball reads white
 * with the laces and the gaps between the bars showing the header through.
 * Using the wrong one on either ground makes it disappear.
 */
export function BrandMark({
  size = 22,
  variant = "dark",
  className = "",
}: {
  size?: number;
  variant?: "dark" | "light";
  className?: string;
}) {
  return (
    <Image
      src={variant === "light" ? "/mark-light.png" : "/mark.png"}
      alt=""
      width={size}
      height={size}
      className={className}
      priority={size <= 32}
    />
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 shrink-0 text-white no-underline group"
      aria-label={`${SITE.name} home`}
    >
      <BrandMark
        size={26}
        variant="light"
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <span className="headline text-[18px] tracking-[-0.02em] leading-none pt-px whitespace-nowrap">
        Gridiron <span className="text-white/70 font-medium">Analytics</span>
      </span>
    </Link>
  );
}
