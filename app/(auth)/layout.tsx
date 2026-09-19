import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";

export const metadata: Metadata = {
  title: {
    default: "Sign in",
    template: "%s · PostBus",
  },
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex justify-center">
            <Logo href="/" />
          </div>
          <div className="rounded-3xl border border-border bg-white p-7 shadow-[0_1px_2px_rgb(9_9_11/0.05),0_12px_40px_rgb(9_9_11/0.08)] sm:p-8 dark:bg-card">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
