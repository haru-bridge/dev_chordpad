import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChordPad",
  description: "Lightweight chord pad for voicing and performance practice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
