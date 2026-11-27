"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { browserNotes, noteFullAnalysis } from "@/lib/finder/hand-off";

/**
 * The Overview's box: a listing link, and "Analyze property". It opens the analysis with the link in its field and
 * leaves this browser the note that starts it (lib/finder/hand-off.ts), so the one press is the one run.
 */
export function QuickStart() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (url.length > 2_000 || !/^https?:\/\/\S+$/i.test(url)) {
      setError("Paste the listing's web address: it starts with https://");
      return;
    }
    noteFullAnalysis(browserNotes(), url, Date.now());
    router.push(`/app/analyze?link=${encodeURIComponent(url)}`);
  }

  return (
    <form onSubmit={submit} className="card p-5 shadow-[0_8px_30px_#143d3508] sm:p-6" data-quick-start>
      <div className="mb-4 flex items-center gap-2.5 text-[15px] font-bold text-ink-900">
        <Icon name="sparkle" className="h-5 w-5 text-[#668263]" />
        Find the potential in your next property.
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] border border-[#dce4dd] bg-[#fafcf9] p-1.5 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2.5 pl-3">
          <Icon name="link" className="h-5 w-5 text-[#88998c]" />
          <span className="sr-only">Listing link</span>
          <input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setError(null);
            }}
            inputMode="url"
            placeholder="Paste a Zillow, Redfin or Realtor.com listing link…"
            className="w-full bg-transparent py-2.5 text-sm text-ink-900 outline-none placeholder:text-[#9aa49d]"
            data-quick-start-link
          />
        </label>
        <button type="submit" className="btn-primary">
          Analyze property
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-pass">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#89958e]">
        <span>A listing link. A renovation plan. A clearer decision. Each analysis uses one of your month&apos;s analyses.</span>
        <Link href="/app/analyze" className="inline-flex items-center gap-1 font-semibold text-ink-950">
          Start with photos instead <Icon name="chevron-right" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </form>
  );
}
