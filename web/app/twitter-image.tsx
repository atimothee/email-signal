import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "EmailSignal — The few things that need you today.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0e1a",
          backgroundImage:
            "radial-gradient(80% 60% at 30% 30%, #1b56b4 0%, rgba(10,14,26,0) 60%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: "Inter, system-ui, sans-serif",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background:
                "radial-gradient(circle at 50% 42%, #2f78de 0%, #1b56b4 55%, #0a2f6b 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 30px rgba(77,158,255,0.5)",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "#f2f7ff",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: -0.4,
            }}
          >
            EmailSignal
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 980 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2.2,
              color: "#f3f5fa",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            The few things that need you{" "}
            <span style={{ color: "#7ab6ff", marginLeft: 14 }}>today.</span>
          </div>
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.35,
              color: "#a8b4cc",
              maxWidth: 880,
              display: "flex",
            }}
          >
            Reads only the Gmail you can see. Never sends or deletes. Open
            source.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#7886a1",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", gap: 24 }}>
            <span>· No Google login</span>
            <span>· No OAuth</span>
            <span>· Your machine</span>
          </div>
          <div style={{ display: "flex" }}>emailsignal.app</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
