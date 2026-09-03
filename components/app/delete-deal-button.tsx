"use client";

import { useTransition } from "react";
import { deleteDeal } from "@/app/app/deals/actions";

export function DeleteDealButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => { if (confirm("Delete this deal?")) start(() => deleteDeal(id)); }}
      disabled={pending}
      className="btn-secondary text-sm text-pass"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
