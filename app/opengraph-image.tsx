import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Renoflip: see the potential, know the profit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The picture a shared link shows: the wordmark, the line, a house. No numbers: a share card has no room to say which are a sample. */
export default async function OpenGraphImage() {
  const photo = await readFile(join(process.cwd(), "public/brand/house-porch.jpg"), "base64");
  const src = `data:image/jpeg;base64,${photo}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#153d35", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640, padding: "60px 52px 60px 68px" }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 800, letterSpacing: -3 }}>
            <span style={{ color: "#b7d39a" }}>reno</span>
            <span>flip</span>
            <span style={{ color: "#e2f5b1" }}>.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>See the potential.</div>
            <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3, color: "#e2f5b1" }}>Know the profit.</div>
            <div style={{ marginTop: 26, fontSize: 24, lineHeight: 1.4, color: "rgba(255,255,255,0.78)" }}>
              Turn a listing into a renovation plan, a smarter offer, and the numbers behind them.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Built for remodelers · Free during beta</div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 560, height: 630 }}>
          <img src={src} alt="" width={560} height={630} style={{ width: 560, height: 630, objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #153d35 0%, rgba(21,61,53,0) 40%)" }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
