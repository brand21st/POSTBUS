import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  light = false,
  as: Tag = "h2",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  light?: boolean;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className
      )}
    >
      {eyebrow ? (
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          {eyebrow}
        </p>
      ) : null}
      <Tag
        className={cn(
          "section-title text-balance",
          light ? "text-white" : "text-ink"
        )}
      >
        {title}
      </Tag>
      {description ? (
        <p
          className={cn(
            "mt-5 text-pretty text-lg leading-relaxed sm:text-xl",
            light ? "text-zinc-400" : "text-muted"
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
