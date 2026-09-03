import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "flip: know it's a good flip before you offer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const photo = await readFile(join(process.cwd(), "public/landing/houses/bungalow.jpg"), "base64");
  const src = `data:image/jpeg;base64,${photo}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#0b1220", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 600, padding: "56px 48px 56px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", width: 44, height: 44, borderRadius: 11, background: "#fff", alignItems: "center", justifyContent: "center", color: "#0b1220", fontSize: 26, fontWeight: 700 }}>f</div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>flip</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2 }}>
              Know it&apos;s a good flip before you offer.
            </div>
            <div style={{ marginTop: 22, fontSize: 22, lineHeight: 1.4, color: "rgba(255,255,255,0.72)" }}>
              Paste the listing. Get GO, TIGHT or PASS, the ARV, the block&apos;s ceiling and what to remodel.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[["GO", "#059669"], ["TIGHT", "#d97706"], ["PASS", "#dc2626"]].map(([v, c]) => (
              <div key={v} style={{ display: "flex", padding: "8px 16px", borderRadius: 10, background: c, fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>{v}</div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 600, height: 630 }}>
          <img src={src} alt="" width={600} height={630} style={{ width: 600, height: 630, objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #0b1220 0%, rgba(11,18,32,0) 45%)" }} />
          <div style={{ position: "absolute", top: 40, right: 40, display: "flex", padding: "12px 22px", borderRadius: 14, background: "#059669", fontSize: 34, fontWeight: 700, letterSpacing: 2, boxShadow: "0 20px 40px rgba(0,0,0,0.35)" }}>GO</div>
          <div style={{ position: "absolute", left: 120, bottom: 40, right: 40, display: "flex", justifyContent: "space-between", padding: "18px 22px", borderRadius: 16, background: "rgba(255,255,255,0.92)", color: "#0b1220" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", letterSpacing: 1 }}>ASKING</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>$699,000</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", letterSpacing: 1 }}>MAX OFFER</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#059669" }}>$779,000</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
