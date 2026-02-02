import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Memories – Persistent Memory for AI Coding Agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "60px",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          <span style={{ fontSize: 80 }}>🧠</span>
          memories
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#a0a0b0",
            textAlign: "center",
            maxWidth: 800,
            lineHeight: 1.4,
          }}
        >
          Persistent memory for AI coding agents
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 22,
            color: "#6366f1",
            background: "rgba(99, 102, 241, 0.1)",
            padding: "12px 28px",
            borderRadius: 12,
            border: "1px solid rgba(99, 102, 241, 0.3)",
          }}
        >
          npx memories
        </div>
      </div>
    ),
    { ...size }
  );
}
