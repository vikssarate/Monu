const $ = (id) => document.getElementById(id);

const BRANDS = [
  "T.I.M.E.","Adda247","Testbook","Oliveboard","BYJU'S Exam Prep",
  "Career Power","PracticeMock","Guidely","ixamBee",
  "BankersDaily","AffairsCloud","Aglasem","StudyIQ","Examstocks"
];

const state = {
  only: "jobs,admit-card,result",
  q: "",
  sources: new Set()
};

async function loadFeed() {
  const res = await fetch("./data/coaching.json?ts=" + Date.now());
  if (!res.ok) throw new Error("Failed to load feed");
  return res.json();
}

function renderBrands() {
  const wrap = $("brands");
  wrap.innerHTML = BRANDS.map(b => `<span class="brand" data-b="${b}">${b}</span>`).join("");
  wrap.addEventListener("click", (e) => {
    const el = e.target.closest(".brand"); if (!el) return;
    const b = el.dataset.b;
    if (state.sources.has(b)) state.sources.delete(b); else state.sources.add(b);
    el.classList.toggle("active");
    render(window.__DATA || { items: [] }); // re-render from cache
  });
}

function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

function render(data) {
  window.__DATA = data;
  const term = state.q.trim().toLowerCase();
  let items = data.items || [];

  if (state.only) {
    const picks = new Set(state.only.split(","));
    items = items.filter(x => picks.has(x.channel));
  }
  if (state.sources.size) {
    items = items.filter(x => state.sources.has(x.source));
  }
  if (term) {
    items = items.filter(x =>
      x.title.toLowerCase().includes(term) || x.source.toLowerCase().includes(term)
    );
  }

  $("list").innerHTML = items.map(it => `
    <li>
      <span class="chip">${escapeHtml(it.source)}</span>
      <span class="chip">${escapeHtml(it.channel)}</span>
      <a href="${it.url}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
      ${it.date ? `<time>${new Date(it.date).toLocaleDateString()}</time>` : "<span></span>"}
    </li>
  `).join("") || `<li>No items.</li>`;

  $("meta").textContent = `· ${items.length} items · updated ${new Date(data.updatedAt).toLocaleTimeString()}`;
}

async function boot() {
  renderBrands();

  $("only").addEventListener("change", () => { state.only = $("only").value; render(window.__DATA || {items:[]}); });
  $("q").addEventListener("input", () => { state.q = $("q").value; render(window.__DATA || {items:[]}); });
  $("reload").addEventListener("click", async () => { $("list").innerHTML = "<li>Loading…</li>"; render(await loadFeed()); });

  $("list").innerHTML = "<li>Loading…</li>";
  try {
    const data = await loadFeed();
    render(data);
  } catch (e) {
    $("list").innerHTML = `<li style="color:#ff7575">Error: ${escapeHtml(String(e.message||e))}</li>`;
  }
}

boot();
