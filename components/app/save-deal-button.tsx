"use client";

import { useState } from "react";
import Link from "next/link";
import { saveDeal } from "@/app/app/deals/actions";
import { Icon } from "@/components/ui/icon";
import type { DealPayload } from "@/lib/deals";
import type { StudioInputs } from "@/lib/engine/studio";

/** Save the result as a deal; `scenario`: the person's Deal Studio inputs when they changed any (kept with the deal). */
export function SaveDealButton({ payload, scenario, onSaved }: { payload: DealPayload; scenario?: StudioInputs | null; onSaved?: (id: string, kept: StudioInputs | null) => void }) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; id?: string; message?: string }>({ status: "idle" });

  async function onSave() {
    setState({ status: "saving" });
    try {
      const result = await saveDeal(payload, scenario ?? undefined);
      setState(result.ok ? { status: "saved", id: result.id } : { status: "error", message: result.error });
      // The page goes on with the saved deal: later changes are saved as its scenario (components/report/studio.tsx).
      if (result.ok) onSaved?.(result.id, scenario ?? null);
    } catch {
      // The action itself did not come back (offline, a server fault): its own words would be a digest, not a sentence.
      setState({ status: "error", message: "Could not save just now. Try again." });
    }
  }

  if (state.status === "saved") {
    return (
      <Link href={`/app/deals/${state.id}`} className="btn-secondary text-sm">
        Saved · open deal
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <button onClick={onSave} disabled={state.status === "saving"} className="btn-primary text-sm">
        <Icon name="bookmark" className="h-4 w-4" />
        {state.status === "saving" ? "Saving…" : scenario ? "Save deal with this scenario" : "Save deal"}
      </button>
      {state.status === "error" && <span className="text-sm text-pass">{state.message}</span>}
    </div>
  );
}
