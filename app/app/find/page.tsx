import { Finder } from "@/components/finder/finder";
import type { MapTiles } from "@/components/finder/deal-map";
import { rentcastFromEnv } from "@/lib/data/house-data";

export const metadata = { title: "Find deals" };
export const dynamic = "force-dynamic";

/**
 * The map's background. With a CARTO key (MAP_TILES_CARTO_KEY: free for commercial use up to a million tiles a
 * month, by CARTO's own terms) its Voyager map; without one, OpenStreetMap's own tiles, which its policy allows
 * for light use and may withdraw. MAP_TILES=off: none (the local stand, which reaches no one).
 */
function mapTiles(env: Record<string, string | undefined> = process.env): MapTiles | null {
  if (env.MAP_TILES === "off") return null;
  const carto = env.MAP_TILES_CARTO_KEY?.trim();
  if (carto && /^[A-Za-z0-9._-]{8,200}$/.test(carto)) {
    return { url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(carto)}`, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' };
  }
  return { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
}

export default function FindDealsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Find deals</h1>
        <p className="mt-1 text-ink-700">The homes for sale in an area, each given a first look: what homes like it have sold for around it, what the repair you expect would cost, and what that leaves you at the asking price.</p>
      </div>
      <Finder connected={rentcastFromEnv() !== null} tiles={mapTiles()} />
    </div>
  );
}
