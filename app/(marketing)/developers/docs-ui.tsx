import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DocsHeader({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-10">
      {kicker ? (
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">{kicker}</p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-[2.15rem]">{title}</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-7 text-zinc-600">{description}</p>
    </header>
  );
}

export function DocsSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-28">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <div className="space-y-4 text-[15px] leading-7 text-zinc-600">{children}</div>
    </section>
  );
}

export function Note({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "ok";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-950",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-950",
  } as const;
  return (
    <aside className={cn("rounded-xl border px-4 py-3 text-sm leading-6", styles[tone])}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-[13.5px] opacity-90">{children}</div>
    </aside>
  );
}

const METHOD: Record<string, string> = {
  GET: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  POST: "bg-blue-50 text-blue-800 ring-blue-200",
  PATCH: "bg-amber-50 text-amber-900 ring-amber-200",
  DELETE: "bg-rose-50 text-rose-800 ring-rose-200",
};

export function Endpoint({
  method,
  path,
  scope,
  purpose,
}: {
  method: string;
  path: string;
  scope?: string;
  purpose?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(9,9,11,0.04)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-zinc-50/80 px-3 py-2.5">
        <span
          className={cn(
            "inline-flex min-w-[3.5rem] justify-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1",
            METHOD[method] ?? "bg-zinc-100 text-zinc-700 ring-zinc-200"
          )}
        >
          {method}
        </span>
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{path}</code>
        {scope ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-medium text-brand-dark">
            {scope}
          </span>
        ) : null}
      </div>
      {purpose ? <p className="px-3 py-2.5 text-[13.5px] leading-6 text-zinc-600">{purpose}</p> : null}
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-rose-50 px-1.5 py-0.5 font-mono text-[12.5px] text-brand-dark">{children}</code>
  );
}

export function DocsTable({
  columns,
  rows,
  monoFirst = true,
}: {
  columns: string[];
  rows: Array<Array<string | ReactNode>>;
  monoFirst?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-2.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={
                    cellIndex === 0 && monoFirst
                      ? "px-4 py-2.5 font-mono text-[12.5px] text-brand-dark"
                      : "px-4 py-2.5 text-zinc-600"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScopeTable({ rows }: { rows: Array<{ scope: string; allows: string }> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Scope</th>
            <th className="px-4 py-2.5 font-semibold">Allows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.scope} className="border-t border-border">
              <td className="px-4 py-2.5 font-mono text-[12.5px] text-brand-dark">{row.scope}</td>
              <td className="px-4 py-2.5 text-zinc-600">{row.allows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardLink({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(9,9,11,0.04)] transition hover:border-rose-200 hover:shadow-md"
    >
      <p className="font-semibold text-ink group-hover:text-brand">{title}</p>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600">{body}</p>
    </a>
  );
}
