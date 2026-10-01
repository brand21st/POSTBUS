"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label?: string; group?: string };

type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  "aria-invalid"?: boolean;
};

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    options,
    value,
    onChange,
    onBlur,
    placeholder = "Search…",
    emptyText = "No matches found",
    className,
    disabled,
    name,
    id,
    "aria-invalid": ariaInvalid,
  },
  forwardedRef
) {
  const generatedId = React.useId();
  const listId = `${id ?? generatedId}-list`;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? selected?.value ?? "";

  const filtered = React.useMemo(() => {
    const term = normalize(query);
    if (!term) return options;
    const starts: ComboboxOption[] = [];
    const contains: ComboboxOption[] = [];
    for (const option of options) {
      const label = normalize(option.label ?? option.value);
      if (label.startsWith(term)) starts.push(option);
      else if (label.includes(term)) contains.push(option);
    }
    return [...starts, ...contains];
  }, [options, query]);

  const grouped = !normalize(query) && options.some((option) => option.group);

  const openList = React.useCallback(() => {
    if (disabled) return;
    setQuery("");
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  }, [disabled, options, value]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commit = React.useCallback(
    (option: ComboboxOption | undefined) => {
      if (option) onChange(option.value);
      close();
    },
    [close, onChange]
  );

  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter")) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      if (normalize(query) && filtered[activeIndex]) onChange(filtered[activeIndex].value);
      close();
    }
  }

  let lastGroup: string | undefined;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        {open ? (
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        ) : null}
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={ariaInvalid}
          aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          disabled={disabled}
          placeholder={open ? selectedLabel || placeholder : placeholder}
          value={open ? query : selectedLabel}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={openList}
          onClick={() => {
            if (!open) openList();
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={cn(
            "flex h-9 w-full cursor-pointer rounded-[var(--radius-input)] border border-border bg-card pl-3.5 pr-9 text-sm text-foreground shadow-sm transition-colors placeholder:text-zinc-400 focus-visible:cursor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-error dark:placeholder:text-zinc-500",
            open && "pl-9 placeholder:text-foreground/60"
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Close list" : "Open list"}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else inputRef.current?.focus();
          }}
          className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground disabled:pointer-events-none"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-foreground shadow-[0_1px_2px_rgb(9_9_11/0.05),0_12px_40px_rgb(9_9_11/0.08)]"
          onPointerDown={(event) => event.preventDefault()}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">{emptyText}</p>
          ) : (
            filtered.map((option, index) => {
              const showGroup = grouped && option.group && option.group !== lastGroup;
              lastGroup = option.group;
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <React.Fragment key={option.value}>
                  {showGroup ? (
                    <p className="sticky -top-1 z-10 -mx-1 bg-popover px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {option.group}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={cn(
                      "relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-2 text-sm",
                      isActive && "bg-surface-soft",
                      isSelected && "font-medium"
                    )}
                  >
                    {isSelected ? <Check className="absolute left-2 size-4 text-brand" /> : null}
                    {option.label ?? option.value}
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
});
