import { ImageResponse } from "next/og";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px",
        background: "#171814",
        color: "#f6f4e8",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 30, color: "#d4ef76", letterSpacing: 6 }}>
        VIBE RACING
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 82,
          fontWeight: 700,
          lineHeight: 1.05,
        }}
      >
        <span>The AI coding</span>
        <span style={{ color: "#d4ef76" }}>token leaderboard.</span>
      </div>
      <div style={{ display: "flex", fontSize: 27 }}>Codex · Claude Code · Cursor · and more</div>
      <div style={{ display: "flex", fontSize: 23, color: "#bbbdae" }}>
        Public totals. Private prompts and code.
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
