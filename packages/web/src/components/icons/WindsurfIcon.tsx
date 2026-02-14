import React from "react"
/**
 * Windsurf icon (placeholder - wave shape)
 */

interface IconProps {
  className?: string;
  size?: number;
}

export function WindsurfIcon({ className, size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M2 12c2-2 4-4 6-4s4 2 6 4 4 4 6 4 4-2 6-4" />
      <path d="M2 6c2-2 4-4 6-4s4 2 6 4 4 4 6 4 4-2 6-4" />
    </svg>
  );
}
