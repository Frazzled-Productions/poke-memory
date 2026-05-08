import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          backgroundColor: "#DC0A2D",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        {/* Lens housing + blue lens */}
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: "50%",
            backgroundColor: "#5BB1F5",
            border: "8px solid white",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
          }}
        >
          {/* Highlight reflection — upper-left */}
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.7)",
              marginTop: 10,
              marginLeft: 10,
            }}
          />
        </div>

        {/* Indicator lights row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: "#FF3B47",
            }}
          />
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: "#FFCB47",
            }}
          />
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: "#4ECB71",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
