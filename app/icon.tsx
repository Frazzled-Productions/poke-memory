import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          backgroundColor: "#DC0A2D",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Blue lens */}
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            backgroundColor: "#5BB1F5",
            border: "2px solid white",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
