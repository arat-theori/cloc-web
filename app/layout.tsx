import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cloc.web — Count Lines of Code in your browser",
  description:
    "Drag a ZIP or paste a GitHub URL to count lines of code by language. Runs entirely in your browser — your code never leaves your machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">{children}</body>
    </html>
  );
}
