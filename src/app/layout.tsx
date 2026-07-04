import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OmniVis Mission Compiler",
  description:
    "Radio-minimal cooperative maritime coverage planner and simulator for fixed-wing UAV teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
