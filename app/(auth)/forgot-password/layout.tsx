import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
