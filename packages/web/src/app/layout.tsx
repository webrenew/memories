import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { VisualEditsMessenger } from "orchids-visual-edits";
import { ThemeProvider } from "@/components/theme-provider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const departureMono = localFont({
  src: [
    { path: "./fonts/DepartureMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/DepartureMono-Regular.woff", weight: "400", style: "normal" },
  ],
  variable: "--font-departure-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://memories.sh"),
  title: {
    default: "Memories – Durable State for Coding Agents",
    template: "%s | Memories",
  },
  description:
    "Store rules once, recall context, and generate native configs for Cursor, Claude Code, Copilot, and more. A local-first state layer for coding agents.",
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
    title: "Memories – Durable State for Coding Agents",
    description:
      "Store rules once, recall context, and generate native configs for Cursor, Claude Code, Copilot, and more. A local-first state layer for coding agents.",
    url: "https://memories.sh",
    siteName: "Memories",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/opengraph.png",
        width: 1200,
        height: 630,
        alt: "Memories – Durable State for Coding Agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Memories – Durable State for Coding Agents",
    description:
      "Store rules once, recall context, and generate native configs for Cursor, Claude Code, Copilot, and more.",
    images: ["/opengraph.png"],
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
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${departureMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <VisualEditsMessenger />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
