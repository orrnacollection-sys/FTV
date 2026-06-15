import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vendor Application — Adwitiya FTV",
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface">{children}</div>;
}
