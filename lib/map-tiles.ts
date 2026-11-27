/** Where a map's background comes from. Null: no background, the pins alone (the local stand, which reaches no one). */
export interface MapTiles {
  url: string;
  attribution: string;
}

/**
 * The maps' background (Find deals, the admin page). With a CARTO key (MAP_TILES_CARTO_KEY: free for commercial use
 * up to a million tiles a month, by CARTO's own terms) its Voyager map; without one, OpenStreetMap's own tiles, which
 * its policy allows for light use and may withdraw. MAP_TILES=off: none (the local stand, which reaches no one).
 */
export function mapTiles(env: Record<string, string | undefined> = process.env): MapTiles | null {
  if (env.MAP_TILES === "off") return null;
  const carto = env.MAP_TILES_CARTO_KEY?.trim();
  if (carto && /^[A-Za-z0-9._-]{8,200}$/.test(carto)) {
    return { url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(carto)}`, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' };
  }
  return { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
}
