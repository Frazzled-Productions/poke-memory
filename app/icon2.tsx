import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon2() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 192,
          height: 192,
          backgroundColor: "#DC0A2D",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 15,
        }}
      >
        {/* Lens housing + blue lens */}
        <div
          style={{
            width: 98,
            height: 98,
            borderRadius: "50%",
            backgroundColor: "#5BB1F5",
            border: "9px solid white",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
          }}
        >
          {/* Highlight reflection - upper-left */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.7)",
              marginTop: 11,
              marginLeft: 11,
            }}
          />
        </div>

        {/* Indicator lights row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 11,
          }}
        >
          <div
            style={{
              width: 17,
              height: 17,
              borderRadius: "50%",
              backgroundColor: "#FF3B47",
            }}
          />
          <div
            style={{
              width: 17,
              height: 17,
              borderRadius: "50%",
              backgroundColor: "#FFCB47",
            }}
          />
          <div
            style={{
              width: 17,
              height: 17,
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
