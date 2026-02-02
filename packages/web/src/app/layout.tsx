import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { VisualEditsMessenger } from "orchids-visual-edits";
import { ThemeProvider } from "@/components/theme-provider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://memories.sh"),
  title: {
    default: "Memories – Persistent Memory for AI Coding Agents",
    template: "%s | Memories",
  },
  description:
    "Give your AI coding agents persistent memory across sessions. Memories is a CLI tool that stores, retrieves, and manages context so Claude, Cursor, and other agents remember what matters.",
  keywords: [
    "AI memory",
    "coding agents",
    "CLI tool",
    "Claude Code",
    "Cursor",
    "persistent context",
    "developer tools",
    "AI developer experience",
  ],
  openGraph: {
    title: "Memories – Persistent Memory for AI Coding Agents",
    description:
      "Give your AI coding agents persistent memory across sessions. A CLI tool that stores, retrieves, and manages context for Claude, Cursor, and other agents.",
    url: "https://memories.sh",
    siteName: "Memories",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Memories – Persistent Memory for AI Coding Agents",
    description:
      "Give your AI coding agents persistent memory across sessions. A CLI tool for Claude, Cursor, and other agents.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <VisualEditsMessenger />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
