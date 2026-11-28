"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import type { MapTiles } from "@/lib/map-tiles";
import type { Pin } from "@/lib/admin/stats";

/** A pin's size grows with the visitors there, by area, so a city with four times the visitors is twice as wide. */
const radius = (visitors: number, most: number) => 6 + 14 * Math.sqrt(visitors / Math.max(1, most));

/** The popup, built as elements: the place's name came from a request header and is set as text, never as markup. */
function popup(pin: Pin): HTMLElement {
  const box = document.createElement("div");
  box.className = "space-y-0.5 text-[13px]";
  const name = document.createElement("div");
  name.className = "font-semibold";
  name.textContent = pin.place;
  const count = document.createElement("div");
  count.textContent = `${pin.visitors} visitor${pin.visitors === 1 ? "" : "s"} · ${pin.visits} page${pin.visits === 1 ? "" : "s"} seen`;
  box.append(name, count);
  return box;
}

/** Where visitors came from: one pin per city, sized by its visitors. The place is the city of the internet address. */
export function VisitMap({ pins, tiles }: { pins: Pin[]; tiles: MapTiles | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let gone = false;
    void import("leaflet").then((L) => {
      if (gone || !el.current || map.current) return;
      // No zoom animation: Leaflet's remove() leaves its zoom-end timer running, and leaving the page within it threw.
      const m = L.map(el.current, { scrollWheelZoom: false, attributionControl: true, worldCopyJump: true, zoomAnimation: false }).setView([39.5, -98.35], 3);
      if (tiles) L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 12 }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      el.current.dataset.ready = "true";
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, [tiles]);

  useEffect(() => {
    let gone = false;
    void import("leaflet").then((L) => {
      const draw = () => {
        if (gone) return;
        if (!map.current || !layer.current) return void setTimeout(draw, 50);
        layer.current.clearLayers();
        const most = pins[0]?.visitors ?? 1;
        // The busiest last, so they lie on top.
        for (const pin of [...pins].reverse()) {
          L.circleMarker([pin.lat, pin.lng], { radius: radius(pin.visitors, most), color: "#ffffff", weight: 2, fillColor: "#e0522a", fillOpacity: 0.85 })
            .bindPopup(() => popup(pin), { maxWidth: 260 })
            .addTo(layer.current);
        }
        // No animation: leaving the page during a zoom left Leaflet finishing it on a removed map (a page error when
        // the owner pressed "Traffic" right away).
        if (pins.length) map.current.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25), { maxZoom: 8, animate: false });
        if (el.current) el.current.dataset.pins = String(pins.length);
      };
      draw();
    });
    return () => {
      gone = true;
    };
  }, [pins]);

  return <div ref={el} className="h-[380px] w-full overflow-hidden rounded-[14px] border border-ink-200 bg-ink-100" data-visit-map role="region" aria-label="Map of where visitors came from" />;
}
