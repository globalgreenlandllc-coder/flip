import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Bookmarklet } from "@/components/app/bookmarklet";

export const metadata = { title: "Browser button" };

const STEPS = [
  { t: "Download the extension", d: "It is a small folder of three scripts. Unzip it somewhere you will keep it." },
  { t: "Open chrome://extensions", d: "Paste that address into Chrome. Turn on Developer mode with the switch in the top-right corner." },
  { t: "Load unpacked", d: "Click Load unpacked and choose the unzipped folder. The extension shows up in the list." },
  { t: "Done", d: "Paste a listing link into New analysis and press Analyze. You will also see an Analyze button on Zillow and Redfin pages." },
];

export default function ExtensionPage() {
  return (
    <div className="max-w-3xl space-y-7">
      <div>
        <p className="eyebrow mb-2.5">One click from any listing</p>
        <h1 className="page-title">Browser button</h1>
        <p className="page-lede">
          Zillow and Redfin let your browser read their pages but block servers. The Chrome extension reads the listing through your browser and hands it to Renoflip, so pasting a link just works. It only talks to listing sites and to Renoflip.
        </p>
      </div>

      <div className="card space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef3ee] text-ink-950">
              <Icon name="puzzle" className="h-5 w-5" />
            </span>
            <div>
              <p className="font-bold text-ink-900">The Chrome extension</p>
              <p className="text-sm text-ink-500">Reads listing pages through your own browser.</p>
            </div>
          </div>
          <a href="/flip-extension.zip" download className="btn-primary">
            <Icon name="download" className="h-4 w-4" />
            Download flip-extension.zip
          </a>
        </div>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.t} className="flex gap-3.5 rounded-xl border border-ink-200 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime text-xs font-bold text-ink-950">{i + 1}</span>
              <div>
                <div className="font-bold text-ink-900">{s.t}</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-500">Until the extension is on the Chrome Web Store, Chrome installs it this way and may remind you about developer-mode extensions when it starts.</p>
      </div>

      <div className="card space-y-3 p-6">
        <p className="font-bold text-ink-900">No extension? Use the bookmark.</p>
        <p className="text-sm leading-relaxed text-ink-500">It works in any browser: drag the button below to your bookmarks bar, then click it on a listing page.</p>
        <Bookmarklet />
      </div>

      <Link href="/app/analyze" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-950">
        Go to New analysis <Icon name="chevron-right" className="h-4 w-4" />
      </Link>
    </div>
  );
}
