import { Finder } from "@/components/finder/finder";
import { rentcastFromEnv } from "@/lib/data/house-data";
import { mapTiles } from "@/lib/map-tiles";

export const metadata = { title: "Find deals" };
export const dynamic = "force-dynamic";

export default function FindDealsPage() {
  return (
    <div>
      <div className="mb-7">
        <p className="eyebrow mb-2.5">Find your next one</p>
        <h1 className="page-title">Find deals</h1>
        <p className="page-lede max-w-3xl">The homes for sale in an area, each given a first look: what homes like it have sold for around it, what the repair you expect would cost, and what that leaves you at the asking price.</p>
      </div>
      <Finder connected={rentcastFromEnv() !== null} tiles={mapTiles()} />
    </div>
  );
}
