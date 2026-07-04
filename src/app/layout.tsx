import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Omnivision",
  description:
    "Radio-minimal cooperative maritime coverage planner and simulator for fixed-wing UAV teams.",
  icons: {
    icon: "/omnivisionfavicon.png",
  },
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
