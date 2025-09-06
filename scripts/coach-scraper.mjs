// scripts/coach-scraper.mjs
// Scrapes coaching/ed-prep sites and writes docs/data/coaching.json (no govt portals)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- net helpers ---------------- */
const DEFAULT_TIMEOUT = Number(process.env.HTTP_TIMEOUT_MS || 12000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": UA,
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const abs = (href, base) =>
  href?.startsWith("http") ? href : href ? new URL(href, base).toString() : null;

async function timeoutFetch(url, { timeoutMs = DEFAULT_TIMEOUT, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("Timeout")), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, ...(opts.headers || {}) },
      redirect: "follow",
      signal: ctrl.signal,
      ...opts,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const html = await res.text();
    if (!html || html.length < 400) throw new Error(`Empty HTML for ${url}`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

// small retry wrapper for flaky sites
async function getHTML(url, { retries = 1, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await timeoutFetch(url, { timeoutMs });
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------------- parsing helpers ---------------- */
function parseDateToISO(s) {
  if (!s) return null;
  const t = s
    .replace(/\bon\b/gi, "")
    .replace(/\badded\b/gi, "")
    .replace(/\bposted\b/gi, "")
    .replace(/[|–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const d = new Date(t);
  if (!Number.isNaN(+d)) return d.toISOString();
  const m = t.match?.(/(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})/);
  if (m) {
    const try2 = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!Number.isNaN(+try2)) return try2.toISOString();
  }
  return null;
}

function classifyChannel(title, fallback) {
  const s = (title || "").toLowerCase();
  if (/\b(admit[-\s]?card|hall[-\s]?ticket|call[-\s]?letter)\b/.test(s)) return "admit-card";
  if (/\bresult(s)?|merit list|final selection|score card\b/.test(s)) return "result";
  if (/\bnotification|releases?|announces?|corrigendum\b/.test(s)) return "notification";
  if (/\brecruitment|vacancy|apply online|application form|jobs?\b/.test(s)) return "jobs";
  if (/\banswer key|response key\b/.test(s)) return "answer-key";
  if (/\bcut ?off\b/.test(s)) return "cutoff";
  return fallback || "news";
}

/* ---------------- generic WP-ish parser ---------------- */
function parseWordpressList(html, base, channel, sourceLabel) {
  const $ = cheerio.load(html);
  const items = [];

  const pick = (root) => {
    const a = root
      .find(
        "h2 a[href], h3 a[href], .entry-title a[href], a[rel='bookmark'], .post-title a[href], .td-module-title a[href]"
      )
      .first();
    const title = (a.text() || "").trim();
    const url = abs(a.attr("href"), base);
    if (!title || !url) return;

    const dateTxt =
      root.find("time").attr("datetime") ||
      root.find("time").text().trim() ||
      root
        .find("[class*='date'], .posted-on, .post-date, .elementor-post-date")
        .first()
        .text()
        .trim() ||
      null;

    items.push({
      source: sourceLabel,
      channel: classifyChannel(title, channel),
      title,
      url,
      date: parseDateToISO(dateTxt),
    });
  };

  $("article").each((_, el) => pick($(el)));
  if (!items.length)
    $(".post, .blog-post, .td-module-container, .elementor-post, li, .card").each((_, el) =>
      pick($(el))
    );

  return items;
}

/* ---------------- T.I.M.E. specific ---------------- */
function parseTIME_NotRes(html) {
  const $ = cheerio.load(html);
  const out = [];
  $("table tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length >= 3) {
      const typeTxt = $(tds[0]).text().trim().toLowerCase();
      const a = $(tds[1]).find("a").first();
      const title = a.text().trim();
      const url = abs(a.attr("href"), "https://www.time4education.com/");
      const date = parseDateToISO($(tds[2]).text().trim() || null);
      if (title && url) {
        const ch = typeTxt.includes("result")
          ? "result"
          : typeTxt.includes("noti")
          ? "notification"
          : "news";
        out.push({ source: "T.I.M.E.", channel: classifyChannel(title, ch), title, url, date });
      }
    }
  });
  return out;
}
function parseTIME_Blocks(html) {
  const $ = cheerio.load(html);
  const out = [];
  const collect = (needle, fallback) => {
    $("h2").each((_, h) => {
      const txt = $(h).text().trim().toLowerCase();
      if (!txt.includes(needle)) return;
      let el = $(h).next();
      while (el.length && el.prop("tagName")?.toLowerCase() !== "h2") {
        el.find("a[href]").each((__, A) => {
          const title = $(A).text().trim();
          const url = abs($(A).attr("href"), "https://www.time4education.com/");
          if (title && url)
            out.push({
              source: "T.I.M.E.",
              channel: classifyChannel(title, fallback),
              title,
              url,
              date: null,
            });
        });
        el = el.next();
      }
    });
  };
  collect("notifications / results", "notification");
  collect("news / articles", "news");
  return out;
}

/* ---------------- source builders ---------------- */
function makeWPScraper(label, base, pages) {
  return async function scrape() {
    const results = [];
    for (const p of pages) {
      try {
        const html = await getHTML(p.url, { retries: 1 });
        results.push(...parseWordpressList(html, base, p.channel, label));
      } catch (e) {
        results.push({ _error: `${label}: ${String(e)}` });
      }
    }
    return results;
  };
}

/* ---------------- sources (coaching only) ---------------- */
const scrapeTestbook = makeWPScraper("Testbook", "https://testbook.com", [
  { url: "https://testbook.com/blog/latest-govt-jobs/", channel: "jobs" },
  { url: "https://testbook.com/blog/admit-card/", channel: "admit-card" },
  { url: "https://testbook.com/blog/results/", channel: "result" },
]);

const scrapeAdda247 = makeWPScraper("Adda247", "https://www.adda247.com", [
  { url: "https://www.adda247.com/jobs/", channel: "jobs" },
  { url: "https://www.adda247.com/tag/admit-card/", channel: "admit-card" },
  { url: "https://www.adda247.com/sarkari-result/", channel: "result" },
]);

const scrapeOliveboard = makeWPScraper("Oliveboard", "https://www.oliveboard.in", [
  { url: "https://www.oliveboard.in/blog/category/recruitment/", channel: "jobs" },
  { url: "https://www.oliveboard.in/blog/category/admit-cards/", channel: "admit-card" },
  { url: "https://www.oliveboard.in/blog/category/results/", channel: "result" },
]);

async function scrapeTIME() {
  const out = [];
  try {
    const html = await getHTML(
      "https://www.time4education.com/local/articlecms/all.php?types=notres",
      { retries: 1 }
    );
    out.push(...parseTIME_NotRes(html));
  } catch (e) {
    out.push({ _error: `T.I.M.E. notres: ${String(e)}` });
  }
  try {
    const html = await getHTML(
      "https://www.time4education.com/local/articlecms/all.php?course=Bank&type=articles",
      { retries: 1 }
    );
    out.push(...parseTIME_Blocks(html));
  } catch (e) {
    out.push({ _error: `T.I.M.E. blocks: ${String(e)}` });
  }
  return out;
}

const scrapeByjusExamPrep = makeWPScraper("BYJU'S Exam Prep", "https://byjusexamprep.com", [
  { url: "https://byjusexamprep.com/blog/category/government-jobs/", channel: "jobs" },
  { url: "https://byjusexamprep.com/blog/category/admit-cards/", channel: "admit-card" },
  { url: "https://byjusexamprep.com/blog/category/results/", channel: "result" },
]);

const scrapeCareerPower = makeWPScraper("Career Power", "https://www.careerpower.in", [
  { url: "https://www.careerpower.in/blog/category/government-jobs", channel: "jobs" },
  { url: "https://www.careerpower.in/blog/tag/admit-card", channel: "admit-card" },
  { url: "https://www.careerpower.in/blog/category/results", channel: "result" },
]);

const scrapePracticeMock = makeWPScraper("PracticeMock", "https://www.practicemock.com", [
  { url: "https://www.practicemock.com/blog/", channel: "news" },
]);

const scrapeGuidely = makeWPScraper("Guidely", "https://guidely.in", [
  { url: "https://guidely.in/blog/category/exams/notifications", channel: "notification" },
  { url: "https://guidely.in/blog/category/exams/admit-card", channel: "admit-card" },
  { url: "https://guidely.in/blog/category/exams/result", channel: "result" },
]);

const scrapeIxamBee = makeWPScraper("ixamBee", "https://www.ixambee.com", [
  { url: "https://www.ixambee.com/blog/category/jobs", channel: "jobs" },
  { url: "https://www.ixambee.com/blog/category/admit-card", channel: "admit-card" },
  { url: "https://www.ixambee.com/blog/category/result", channel: "result" },
]);

const scrapeBankersDaily = makeWPScraper("BankersDaily", "https://www.bankersdaily.in", [
  { url: "https://www.bankersdaily.in/category/exams/recruitment/", channel: "jobs" },
  { url: "https://www.bankersdaily.in/category/admit-card/", channel: "admit-card" },
  { url: "https://www.bankersdaily.in/category/results/", channel: "result" },
]);

const scrapeAffairsCloud = makeWPScraper("AffairsCloud", "https://affairscloud.com", [
  { url: "https://affairscloud.com/jobs/", channel: "jobs" },
  { url: "https://affairscloud.com/tag/admit-card/", channel: "admit-card" },
  { url: "https://affairscloud.com/tag/result/", channel: "result" },
]);

const scrapeAglasem = makeWPScraper("Aglasem", "https://aglasem.com", [
  { url: "https://aglasem.com/category/jobs/", channel: "jobs" },
  { url: "https://aglasem.com/category/admit-card/", channel: "admit-card" },
  { url: "https://aglasem.com/category/result/", channel: "result" },
]);

const scrapeStudyIQ = makeWPScraper("StudyIQ", "https://studyiq.com", [
  { url: "https://studyiq.com/category/jobs/", channel: "jobs" },
  { url: "https://studyiq.com/category/admit-card/", channel: "admit-card" },
  { url: "https://studyiq.com/category/result/", channel: "result" },
]);

const scrapeExamstocks = makeWPScraper("Examstocks", "https://www.examstocks.com", [
  { url: "https://www.examstocks.com/category/jobs/", channel: "jobs" },
  { url: "https://www.examstocks.com/category/admit-card/", channel: "admit-card" },
  { url: "https://www.examstocks.com/category/result/", channel: "result" },
]);

const SOURCES = [
  scrapeTestbook,
  scrapeAdda247,
  scrapeOliveboard,
  scrapeTIME,
  scrapeByjusExamPrep,
  scrapeCareerPower,
  scrapePracticeMock,
  scrapeGuidely,
  scrapeIxamBee,
  scrapeBankersDaily,
  scrapeAffairsCloud,
  scrapeAglasem,
  scrapeStudyIQ,
  scrapeExamstocks,
];

/* ---------------- aggregation ---------------- */
function dedupeSort(items) {
  const byUrl = new Map();
  for (const it of items) {
    if (!it?.url) continue;
    if (!byUrl.has(it.url)) byUrl.set(it.url, it);
    else {
      const prev = byUrl.get(it.url);
      if (!prev.date && it.date) byUrl.set(it.url, { ...prev, date: it.date });
    }
  }
  const arr = Array.from(byUrl.values()).filter((x) => !x._error);
  arr.sort((a, b) => {
    const order = {
      jobs: 0,
      "admit-card": 1,
      result: 2,
      "answer-key": 3,
      cutoff: 4,
      notification: 5,
      news: 6,
    };
    const ra = order[a.channel] ?? 99;
    const rb = order[b.channel] ?? 99;
    if (ra !== rb) return ra - rb;
    return (b.date || "").localeCompare(a.date || "");
  });
  return arr;
}

/* ---------------- main ---------------- */
async function main() {
  const only = (process.env.ONLY || "").split(",").filter(Boolean);
  const pick = (process.env.SOURCE || "").split(",").filter(Boolean);

  const chunks = await Promise.allSettled(SOURCES.map((fn) => fn()));
  let items = [];
  const errors = [];

  for (const r of chunks) {
    if (r.status === "fulfilled") {
      const ok = r.value.filter((x) => !x._error);
      const errs = r.value.filter((x) => x._error).map((x) => x._error);
      items.push(...ok);
      errors.push(...errs);
    } else {
      errors.push(String(r.reason));
    }
  }

  if (only.length) items = items.filter((x) => only.includes(x.channel));
  if (pick.length)
    items = items.filter((x) =>
      pick.some((s) => x.source.toLowerCase().includes(s.toLowerCase()))
    );

  items = dedupeSort(items);

  const out = {
    ok: true,
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  if (process.env.DEBUG === "1") out.errors = errors.slice(0, 30);

  const outDir = path.join(__dirname, "..", "docs", "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "coaching.json");
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.count} items to ${path.relative(process.cwd(), outFile)}`);
}

/* Always write a JSON file, even if something blows up */
(async () => {
  try {
    await main();
  } catch (e) {
    console.error("SCRAPE FAILED:", e && (e.stack || e));
    const fallback = {
      ok: false,
      updatedAt: new Date().toISOString(),
      count: 0,
      items: [],
      error: String(e.message || e),
    };
    const outDir = path.join(__dirname, "..", "docs", "data");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "coaching.json"), JSON.stringify(fallback, null, 2));
    // NOTE: don't throw—let the workflow commit the file
  }
})();
