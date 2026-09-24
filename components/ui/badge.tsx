import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface-soft text-foreground",
        brand: "border-transparent bg-rose-100 text-brand-dark",
        success: "border-transparent bg-emerald-100 text-emerald-800",
        warning: "border-amber-200/80 bg-amber-100 text-amber-900 dark:border-transparent dark:bg-warning/15 dark:text-amber-300",
        error: "border-transparent bg-red-100 text-red-800",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
