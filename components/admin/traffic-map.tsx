"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import type { MapTiles } from "@/lib/map-tiles";
import { AD_RING, STAGE_COLOR, STAGE_LABEL, type MapPin } from "@/lib/admin/traffic-shared";

/** The popup, built as elements: the place's name came from a request header and is set as text, never as markup. */
function popup(pin: MapPin): HTMLElement {
  const box = document.createElement("div");
  box.className = "space-y-0.5 text-[13px]";
  const lines = [STAGE_LABEL[pin.stage] + (pin.now ? " · on the site now" : ""), pin.place, `From ${pin.source}${pin.ad ? " · an ad" : ""}`];
  lines.forEach((text, i) => {
    const el = document.createElement("div");
    el.textContent = text;
    if (i === 0) el.className = "font-semibold";
    box.append(el);
  });
  return box;
}

/**
 * Where the visitors are: one pin per visitor, coloured by what they are doing (the legend beside the map says which
 * colour is which), a violet ring for a visitor from an ad, a soft pulse around anyone on the site now.
 */
export function TrafficMap({ pins, tiles, selected, onSelect }: { pins: MapPin[]; tiles: MapTiles | null; selected: string | null; onSelect: (visitor: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const select = useRef(onSelect);
  const picked = useRef(selected);
  const fitted = useRef(false);
  useEffect(() => {
    select.current = onSelect;
    picked.current = selected;
  }, [onSelect, selected]);

  useEffect(() => {
    let gone = false;
    const placed = markers.current;
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
      placed.clear();
    };
  }, [tiles]);

  useEffect(() => {
    let gone = false;
    void import("leaflet").then((L) => {
      const draw = () => {
        if (gone) return;
        if (!map.current || !layer.current) return void setTimeout(draw, 50);
        layer.current.clearLayers();
        markers.current.clear();
        // Oldest first, so the newest lie on top.
        for (const pin of [...pins].reverse()) {
          if (pin.now) L.circleMarker([pin.lat, pin.lng], { radius: 15, stroke: false, fillColor: STAGE_COLOR[pin.stage], fillOpacity: 0.22, className: "rf-pulse", interactive: false }).addTo(layer.current);
          const marker = L.circleMarker([pin.lat, pin.lng], { radius: 8, color: pin.ad ? AD_RING : "#ffffff", weight: pin.ad ? 3 : 2, fillColor: STAGE_COLOR[pin.stage], fillOpacity: 0.95 })
            .bindPopup(() => popup(pin), { maxWidth: 260 })
            .on("click", () => select.current(pin.visitor));
          marker.addTo(layer.current);
          const dot = marker.getElement?.() as SVGElement | undefined;
          dot?.setAttribute("data-stage", pin.stage);
          dot?.setAttribute("data-visitor", pin.visitor);
          markers.current.set(pin.visitor, marker);
        }
        // Fitted once to the first pins; after that the view stays where the owner put it while the data refreshes.
        // No animation: a refresh can redraw the pins while a move is under way, and Leaflet then fails on the gone pin.
        if (pins.length && !fitted.current) {
          map.current.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 9, animate: false });
          fitted.current = true;
        }
        // The visitor chosen in the list keeps their popup open through a refresh.
        if (picked.current) markers.current.get(picked.current)?.openPopup();
        if (el.current) el.current.dataset.pins = String(pins.length);
      };
      draw();
    });
    return () => {
      gone = true;
    };
  }, [pins]);

  useEffect(() => {
    if (!selected) return;
    const marker = markers.current.get(selected);
    if (marker && map.current) {
      map.current.setView(marker.getLatLng(), Math.max(map.current.getZoom(), 7), { animate: false });
      marker.openPopup();
    }
  }, [selected]);

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-[14px] border border-ink-200 bg-ink-100" data-traffic-map role="region" aria-label="Map of the visitors, coloured by what each is doing" />;
}
