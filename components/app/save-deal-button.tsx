"use client";

import { useState } from "react";
import Link from "next/link";
import { saveDeal } from "@/app/app/deals/actions";
import type { DealPayload } from "@/lib/deals";

export function SaveDealButton({ payload }: { payload: DealPayload }) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; id?: string; message?: string }>({ status: "idle" });

  async function onSave() {
    setState({ status: "saving" });
    try {
      const result = await saveDeal(payload);
      setState(result.ok ? { status: "saved", id: result.id } : { status: "error", message: result.error });
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
        {state.status === "saving" ? "Saving…" : "Save deal"}
      </button>
      {state.status === "error" && <span className="text-sm text-pass">{state.message}</span>}
    </div>
  );
}
