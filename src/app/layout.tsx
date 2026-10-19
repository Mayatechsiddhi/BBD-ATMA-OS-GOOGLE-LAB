import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "BBD Master ATMA OS", template: "%s | BBD ATMA" },
  description: "Bharath Bloom Digital business operating system",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
