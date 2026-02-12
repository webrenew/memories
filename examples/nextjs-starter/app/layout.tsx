import type { Metadata } from "next"
import { Space_Mono, Syne } from "next/font/google"
import type { ReactNode } from "react"
import "./globals.css"

const heading = Syne({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-heading",
})

const body = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-body",
})

export const metadata: Metadata = {
  title: "Memories Next Starter",
  description: "Add, search, and context flows with @memories.sh/core",
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable}`}>{children}</body>
    </html>
  )
}
