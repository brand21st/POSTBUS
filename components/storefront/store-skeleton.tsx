export function StoreSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-7xl animate-pulse bg-zinc-50">
      <div className="sticky top-0 z-20 border-b border-zinc-100 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="size-10 rounded-full bg-zinc-200" />
          <div className="space-y-2">
            <div className="h-3.5 w-28 rounded bg-zinc-200" />
            <div className="h-2.5 w-20 rounded bg-zinc-100" />
          </div>
          <div className="hidden h-11 flex-1 rounded-2xl bg-zinc-200 lg:block" />
          <div className="ml-auto size-10 rounded-full bg-zinc-100" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="h-11 rounded-2xl bg-zinc-200 lg:hidden" />
        <div className="mt-3 aspect-[16/9] max-h-[148px] rounded-2xl bg-zinc-200 sm:max-h-[220px] lg:aspect-[2.6/1] lg:max-h-[240px] sm:rounded-3xl" />
        <div className="mt-4 flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="shrink-0 space-y-2 text-center">
              <div className="size-12 rounded-full bg-zinc-200 sm:size-14 lg:h-10 lg:w-24 lg:rounded-full" />
              <div className="mx-auto h-2.5 w-10 rounded bg-zinc-100 lg:hidden" />
            </div>
          ))}
        </div>
        <div className="mt-6 h-5 w-32 rounded bg-zinc-200" />
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(220px,260px))]">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-100">
              <div className="aspect-square bg-zinc-200" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-4/5 rounded bg-zinc-200" />
                <div className="h-4 w-1/2 rounded bg-zinc-200" />
                <div className="h-10 rounded-xl bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
