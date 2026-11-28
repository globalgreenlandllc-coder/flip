import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "RenoFlip: know what to pay, see what you keep";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The picture a shared link shows, in the light landing's palette: the mark and name, the line, a house. No numbers:
 *  a share card has no room to say which are a sample. */
export default async function OpenGraphImage() {
  const photo = await readFile(join(process.cwd(), "public/brand/house-porch.jpg"), "base64");
  const src = `data:image/jpeg;base64,${photo}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#f7f8fa", color: "#141820", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 680, padding: "60px 52px 60px 68px" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="56" height="56" viewBox="0 0 48 48">
              <rect width="48" height="48" rx="13" fill="#ff6a3d" />
              <path d="M9 23 24 10l15 13" fill="none" stroke="#101820" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18 23h15v5H23v4h8v5h-8v6h-5z" fill="#101820" />
            </svg>
            <div style={{ display: "flex", marginLeft: 16, fontSize: 46, fontWeight: 800, letterSpacing: -3 }}>
              <span>Reno</span>
              <span style={{ color: "#ff6a3d" }}>Flip</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.06, letterSpacing: -3 }}>Know what to pay.</div>
            <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.06, letterSpacing: -3, color: "#7a818d" }}>See what you keep.</div>
            <div style={{ marginTop: 26, fontSize: 24, lineHeight: 1.45, color: "#596170" }}>
              The most you can offer, a renovation plan from the photos, and what is left after every project cost.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 18, color: "#626a77" }}>A clearer way to look at a flip · Free during beta</div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 520, height: 630 }}>
          <img src={src} alt="" width={520} height={630} style={{ width: 520, height: 630, objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #f7f8fa 0%, rgba(247,248,250,0) 35%)" }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
