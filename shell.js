// Shared mission list + page switch. The current mission travels between pages as ?m=N.
window.Shell = (() => {
  const TYPES = {
    attendant: { name: "Ask for directions", color: "var(--t-attendant)", bg: "#e9f0fc" },
    chat:      { name: "Phone call",         color: "var(--t-chat)",      bg: "#e4f3ed" },
    order:     { name: "Ordering food",      color: "var(--t-order)",     bg: "#fcede4" }
  };
  const clean = t => String(t).replace(/^\d+\.\s*/, "");
  function startIndex(n) {
    const m = parseInt(new URLSearchParams(location.search).get("m"), 10);
    return m >= 1 && m <= n ? m - 1 : 0;
  }
  function render(navEl, items, cur) {
    navEl.innerHTML = Object.entries(TYPES).map(([t, T]) =>
      `<div class="group"><h2><i style="background:${T.color}"></i>${T.name}</h2>` +
      items.map((m, i) => m.type !== t ? "" :
        `<button type="button" data-i="${i}" aria-current="${i === cur}"><span class="num" style="background:${T.color}">${i + 1}</span>${clean(m.title)}</button>`
      ).join("") + "</div>").join("");
    const u = new URL(location.href); u.searchParams.set("m", cur + 1); history.replaceState(null, "", u);
    document.querySelectorAll(".switch a").forEach(a => { const h = new URL(a.href); h.searchParams.set("m", cur + 1); a.href = h.pathname + h.search; });
    const on = navEl.querySelector('[aria-current="true"]');
    if (on && getComputedStyle(navEl).display === "flex") on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  return { TYPES, clean, startIndex, render };
})();
