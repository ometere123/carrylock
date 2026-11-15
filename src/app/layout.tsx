import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CARRYLOCK — The handover evidence desk", template: "%s · CARRYLOCK" },
  description: "Recover missing handover evidence and track open safety obligations across shifts.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
