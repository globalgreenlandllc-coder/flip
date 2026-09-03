import Link from "next/link";

export const metadata = { title: "Chrome extension" };

const STEPS = [
  { t: "Download the extension", d: "It is a small folder of three scripts. Unzip it somewhere you will keep it." },
  { t: "Open chrome://extensions", d: "Paste that address into Chrome. Turn on Developer mode with the switch in the top-right corner." },
  { t: "Load unpacked", d: "Click Load unpacked and choose the unzipped folder. You will see flip in the list." },
  { t: "Done", d: "Come back here, paste a listing link and press Analyze. You will also see an Analyze in flip button on Zillow and Redfin pages." },
];

export default function ExtensionPage() {
  return (
    <div className="max-w-2xl">
      <Link href="/app" className="text-sm text-ink-500 hover:text-ink-950">← New analysis</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Chrome extension</h1>
      <p className="mt-2 text-ink-700">
        Zillow and Redfin let your browser read their pages but block servers. The extension reads the listing through your browser and hands it to flip, so pasting a link just works. It only talks to listing sites and to flip.
      </p>
      <a href="/flip-extension.zip" download className="btn-primary mt-6">Download flip-extension.zip</a>
      <ol className="mt-8 space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.t} className="card flex gap-4 p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">{i + 1}</span>
            <div>
              <div className="font-semibold">{s.t}</div>
              <p className="mt-1 text-sm text-ink-700">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-ink-500">Until the extension is on the Chrome Web Store, Chrome installs it this way and may remind you about developer-mode extensions when it starts.</p>
    </div>
  );
}
