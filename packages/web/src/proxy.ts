import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest, NextResponse } from "next/server"

export async function proxy(request: NextRequest): Promise<NextResponse> {
  return await updateSession(request)
}

export const config = {
  matcher: [
    "/app/:path*",
    "/login",
    "/invite/accept",
  ],
}
