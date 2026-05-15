import { ImageResponse } from "next/og";

export const alt = "Poké Memory — spaced repetition flashcards for every Pokémon";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          backgroundColor: "#DC0A2D",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 72,
          fontFamily: "sans-serif",
          padding: "0 80px",
        }}
      >
        {/* Pokédex lens icon — mirrors the apple-icon design */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            flexShrink: 0,
          }}
        >
          {/* Lens housing */}
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: "50%",
              backgroundColor: "#5BB1F5",
              border: "16px solid white",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "flex-start",
            }}
          >
            {/* Highlight reflection — upper-left */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                backgroundColor: "rgba(255,255,255,0.7)",
                marginTop: 22,
                marginLeft: 22,
              }}
            />
          </div>

          {/* Indicator lights row */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 20,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "#FF3B47",
              }}
            />
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "#FFCB47",
              }}
            />
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "#4ECB71",
              }}
            />
          </div>
        </div>

        {/* Text block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              color: "#FFFFFF",
              letterSpacing: "-2px",
              lineHeight: 1,
            }}
          >
            Poké Memory
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 400,
              color: "rgba(255,255,255,0.85)",
              lineHeight: 1.3,
              maxWidth: 560,
            }}
          >
            Learn every Pokémon name and evolution with spaced repetition.
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 26,
              fontWeight: 600,
              color: "rgba(255,255,255,0.65)",
              letterSpacing: "0.5px",
            }}
          >
            pokememory.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
