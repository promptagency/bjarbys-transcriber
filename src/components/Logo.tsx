import logo from "../assets/vem-sa-vad-farg.svg";

/**
 * The logo, exactly as delivered in the brand pack: never recoloured, never
 * given effects. At least 48 px high and never under 120 px wide; the width
 * and height attributes give the browser its 935 × 324 proportion up front.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src={logo}
      alt="Vem sa vad?"
      width={935}
      height={324}
      className={`h-28 w-auto min-w-[120px] ${className}`}
    />
  );
}
