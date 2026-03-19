import type { ReactNode } from "react";
import type { Metadata } from "next";
import DashboardShell from "@/components/layout/DashboardShell";

export const metadata: Metadata = {
  title: "NOAP – Network Operations",
  description: "Enterprise Network Operations Platform",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
