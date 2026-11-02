import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
  actionsClassName,
}: {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  actionsClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h1 className="flex min-h-7 items-center overflow-visible text-xl font-semibold leading-none tracking-tight text-ink sm:min-h-8 sm:text-2xl">
            {title}
          </h1>
          {description ? <p className="mt-0.5 line-clamp-1 text-xs text-muted sm:text-sm">{description}</p> : null}
        </div>
      </div>
      {actions ? (
        <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:justify-end", actionsClassName)}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
