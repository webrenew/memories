import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path");

  if (!path) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Sanitize path to prevent directory traversal
  const sanitizedPath = path.replace(/\.\./g, "").replace(/^\/+/, "");
  
  try {
    // Try to read the MDX file from content/docs
    const filePath = join(process.cwd(), "content", "docs", `${sanitizedPath}.mdx`);
    const content = await readFile(filePath, "utf-8");
    
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Failed to read MDX file:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
