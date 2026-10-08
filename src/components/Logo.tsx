import logo from "../assets/vem-sa-vad-farg.svg";

/**
 * The logo, exactly as delivered in the brand pack: never recoloured, never
 * given effects. At least 48 px high and never under 120 px wide. Sized by
 * width (404 px ≈ 140 px high) and shrunk with the screen rather than cropped;
 * the width and height attributes keep its 935 × 324 proportion.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src={logo}
      alt="Vem sa vad?"
      width={935}
      height={324}
      className={`h-auto w-[404px] max-w-full min-w-[120px] ${className}`}
    />
  );
}
