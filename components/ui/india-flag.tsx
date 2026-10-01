import type { SVGProps } from "react";

export function IndiaFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 30 20" role="img" aria-label="India flag" preserveAspectRatio="none" {...props}>
      <rect width="30" height="20" fill="#ffffff" />
      <rect width="30" height="6.67" fill="#FF9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.6" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
      {Array.from({ length: 12 }, (_, index) => (
        <line
          key={index}
          x1="15"
          y1="7.4"
          x2="15"
          y2="12.6"
          stroke="#000080"
          strokeWidth="0.25"
          transform={`rotate(${index * 15} 15 10)`}
        />
      ))}
    </svg>
  );
}
