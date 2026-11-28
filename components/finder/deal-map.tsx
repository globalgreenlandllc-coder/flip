"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import type { Heat } from "@/lib/engine/screen";
import { browserNotes, noteFullAnalysis } from "@/lib/finder/hand-off";
import { analyzeHref, money, zillowHref, type MapHome } from "./shared";

import type { MapTiles } from "@/lib/map-tiles";

export type { MapTiles };

/** Hot pins stand out: bigger, and in the color of the profit reached. */
const PIN: Record<Heat, { radius: number; color: string; fill: string; fillOpacity: number; weight: number }> = {
  hot: { radius: 11, color: "#ffffff", fill: "#ea580c", fillOpacity: 0.95, weight: 3 },
  warm: { radius: 8, color: "#ffffff", fill: "#f59e0b", fillOpacity: 0.9, weight: 2 },
  cold: { radius: 6, color: "#ffffff", fill: "#94a3b8", fillOpacity: 0.85, weight: 1.5 },
  unknown: { radius: 6, color: "#94a3b8", fill: "#ffffff", fillOpacity: 0.9, weight: 2 },
};

/** The popup of a pin, built as elements: every word in it came from a listing record and is set as text, never as markup. */
function popupContent(home: MapHome): HTMLElement {
  const box = document.createElement("div");
  box.className = "space-y-1 text-[13px]";
  const line = (text: string, cls = "") => {
    const el = document.createElement("div");
    el.textContent = text;
    if (cls) el.className = cls;
    box.appendChild(el);
  };
  line(home.address, "font-semibold");
  line(`Asking ${money(home.price)}${home.listingType && home.listingType !== "Standard" ? ` · ${home.listingType}` : ""}`);
  if (home.value) line(`Similar homes sold for ${money(home.value.point)} (${home.value.sales} sale${home.value.sales === 1 ? "" : "s"}, ${home.value.confidence} confidence)`);
  if (home.profit !== null) line(`${home.heat === "hot" ? "Your target is reached" : home.profit > 0 ? "Some profit, short of your target" : "No profit at the asking price"}: ${money(home.profit)} left at asking`, home.heat === "hot" ? "font-medium text-orange-700" : "");
  else line(home.why ?? "Cannot be valued.", "text-ink-500");
  if (home.maxOffer !== null) line(`Most you could pay for your target, on that value: ${money(home.maxOffer)}`);
  line("A first look: the repair is your guess, no photos read. A full analysis may come out lower once its renovation plan is priced.", "text-[11px] text-ink-500");
  const links = document.createElement("div");
  links.className = "flex gap-3 pt-1";
  // Both in a new tab: the search stays where it is. Full analysis's click leaves the note that starts the analysis
  // there (lib/finder/hand-off.ts).
  for (const [href, text, rel, full] of [[zillowHref(home.address), "See on Zillow", "noreferrer noopener", false], [analyzeHref(home), "Full analysis", "noopener", true]] as const) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    a.className = "font-medium underline";
    a.target = "_blank";
    a.rel = rel;
    if (full) {
      const note = () => noteFullAnalysis(browserNotes(), home.address, Date.now());
      a.addEventListener("click", note);
      // The middle button opens a tab too; a right click (which some browsers also report here) leaves no note.
      a.addEventListener("auxclick", (e) => {
        if (e.button === 1) note();
      });
    }
    links.appendChild(a);
  }
  box.appendChild(links);
  return box;
}

export function DealMap({ homes, selected, onSelect, tiles }: { homes: MapHome[]; selected: string | null; onSelect: (id: string) => void; tiles: MapTiles | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const pins = useRef(new Map<string, CircleMarker>());
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  // The map itself, once. Leaflet reads the window, so it is loaded in the browser only.
  useEffect(() => {
    let gone = false;
    const placed = pins.current;
    void import("leaflet").then((L) => {
      if (gone || !el.current || map.current) return;
      // No zoom animation: Leaflet's remove() leaves its zoom-end timer running, and leaving the page within it threw.
      const m = L.map(el.current, { scrollWheelZoom: false, attributionControl: true, zoomAnimation: false }).setView([47.45, -122.3], 9);
      if (tiles) L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      el.current.dataset.ready = "true";
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      placed.clear();
    };
  }, [tiles]);

  // The pins: drawn again whenever the homes change, the hot ones last so they lie on top.
  useEffect(() => {
    let gone = false;
    void import("leaflet").then((L) => {
      const draw = () => {
        if (gone) return;
        if (!map.current || !layer.current) return void setTimeout(draw, 50);
        layer.current.clearLayers();
        pins.current.clear();
        const order: Heat[] = ["unknown", "cold", "warm", "hot"];
        const placed = [...homes].sort((a, b) => order.indexOf(a.heat) - order.indexOf(b.heat));
        for (const home of placed) {
          const style = PIN[home.heat];
          const pin = L.circleMarker([home.lat, home.lng], { radius: style.radius, color: style.color, weight: style.weight, fillColor: style.fill, fillOpacity: style.fillOpacity })
            .bindPopup(() => popupContent(home), { maxWidth: 280 })
            .on("click", () => select.current(home.id));
          pin.addTo(layer.current);
          (pin.getElement?.() as SVGElement | undefined)?.setAttribute("data-heat", home.heat);
          pins.current.set(home.id, pin);
        }
        if (placed.length) map.current.fitBounds(L.latLngBounds(placed.map((h) => [h.lat, h.lng] as [number, number])).pad(0.15), { maxZoom: 15 });
        if (el.current) el.current.dataset.pins = String(placed.length);
      };
      draw();
    });
    return () => {
      gone = true;
    };
  }, [homes]);

  // The home chosen in the list: its pin's popup opened.
  useEffect(() => {
    if (!selected) return;
    const pin = pins.current.get(selected);
    if (pin && map.current) {
      map.current.panTo(pin.getLatLng());
      pin.openPopup();
    }
  }, [selected]);

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-xl border border-ink-200 bg-ink-100" data-deal-map role="region" aria-label="Map of the homes for sale" />;
}
