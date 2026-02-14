import React from "react"
import Image from "next/image";

type ToolLogoSize = "xs" | "sm" | "md" | "md-lg" | "lg";

const sizeMap: Record<ToolLogoSize, { px: number; className: string }> = {
  xs: { px: 16, className: "h-4 w-4" },
  sm: { px: 24, className: "h-6 w-6" },
  md: { px: 40, className: "h-10 w-10" },
  "md-lg": { px: 60, className: "h-[60px] w-[60px]" },
  lg: { px: 56, className: "h-14 w-14" },
};

interface ToolLogoProps {
  src: string;
  alt: string;
  /** xs=16px, sm=24px, md=40px, lg=56px */
  size?: ToolLogoSize;
  className?: string;
}

export function ToolLogo({ src, alt, size = "md", className = "" }: ToolLogoProps): React.JSX.Element {
  const { px, className: sizeClass } = sizeMap[size];
  return (
    <Image
      src={src}
      alt={alt}
      width={px}
      height={px}
      className={`${sizeClass} object-contain dark:invert-0 invert ${className}`}
    />
  );
}
