"use client";

import { useEffect, useRef } from "react";

/**
 * "flip it": a bookmark that runs on the listing page in the user's own
 * browser, where Zillow and Redfin already served the page. It collects the
 * gallery photos and the page text and opens the analyzer pre-filled.
 * React blocks javascript: hrefs in JSX, so the href is set on the DOM node.
 */
function bookmarkletCode(origin: string): string {
  const src = `(function(){
var imgs=[].slice.call(document.images).map(function(i){return i.currentSrc||i.src}).filter(function(s){return /^https?:/.test(s)&&/(zillowstatic|cdn-redfin|rdcpix|ssl\\.cdn|photos|images|media)/i.test(s)&&!/(logo|icon|avatar|sprite|map)/i.test(s)});
var seen={},u=[];for(var k=0;k<imgs.length;k++){if(!seen[imgs[k]]){seen[imgs[k]]=1;u.push(imgs[k]);}}
var t=(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,2000);
window.open(${JSON.stringify(origin)}+'/app?listing='+encodeURIComponent(location.href)+'&photos='+encodeURIComponent(u.slice(0,30).join(','))+'&text='+encodeURIComponent(t),'_blank');
})();`;
  return "javascript:" + encodeURIComponent(src);
}

export function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", bookmarkletCode(window.location.origin));
  }, []);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-700">
      <a
        ref={ref}
        href="#"
        draggable
        onClick={(e) => e.preventDefault()}
        className="inline-flex cursor-grab items-center gap-1.5 rounded-md bg-ink-950 px-2.5 py-1.5 text-xs font-semibold text-white active:cursor-grabbing"
        title="Drag me to your bookmarks bar"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 11.5 12 4l9 7.5M5 10.5V20h14v-9.5" /></svg>
        flip it
      </a>
      <span>
        <span className="font-medium text-ink-900">One click from any listing:</span> drag this button to your bookmarks bar. On a Zillow or Redfin page, click it and the photos, price and facts land here.
      </span>
    </div>
  );
}
