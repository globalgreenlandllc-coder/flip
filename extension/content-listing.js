// On a listing page: one button that opens flip with the photos and facts.
(() => {
  const APP = "https://flip-nu-five.vercel.app";
  if (document.getElementById("flip-analyze-btn")) return;

  function collect() {
    const seen = new Set();
    const photos = [];
    for (const img of Array.from(document.images)) {
      const s = img.currentSrc || img.src;
      if (!/^https?:/.test(s)) continue;
      if (!/(zillowstatic|cdn-redfin|rdcpix|ssl\.cdn|photos|images|media)/i.test(s)) continue;
      if (/(logo|icon|avatar|sprite|map|pixel)/i.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      photos.push(s);
    }
    const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 2000);
    return { photos: photos.slice(0, 30), text };
  }

  const btn = document.createElement("button");
  btn.id = "flip-analyze-btn";
  btn.textContent = "Analyze in flip";
  Object.assign(btn.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    background: "#0b1220", color: "#fff", border: "0", borderRadius: "10px",
    padding: "12px 16px", font: "600 14px system-ui, -apple-system, sans-serif",
    boxShadow: "0 10px 30px rgba(11,18,32,.35)", cursor: "pointer",
  });
  btn.addEventListener("click", () => {
    const { photos, text } = collect();
    const q = new URLSearchParams({ listing: location.href, photos: photos.join(","), text });
    window.open(`${APP}/app?${q.toString()}`, "_blank");
  });
  document.body.appendChild(btn);
})();
