import type { Metadata } from "next";
import { Fredoka } from "next/font/google";
import "./globals.css";

const display = Fredoka({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chopsticks",
  description: "Play Chopsticks against the computer — four rule variants.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={display.variable}>
      <body className="min-h-screen font-display antialiased">{children}</body>
    </html>
  );
}
