# Coaching Updates (GitHub Pages + Actions)

**What it does**
- Scrapes coaching/ed-prep sites (no govt portals)
- Writes `docs/data/coaching.json`
- Serves a static UI from `docs/` with GitHub Pages
- Updates hourly via GitHub Actions

## Setup
1. Push this repo to GitHub.
2. Enable **GitHub Pages**:  
   Settings → Pages → Build and deployment → **Branch: `main`**, **Folder: `/docs`**.
3. Run the workflow once: Actions → **Update coaching feed** → **Run workflow**.

Your site will be at: `https://<your-username>.github.io/<repo-name>/`

## Local run
```bash
npm i
npm run scrape
# open docs/index.html in a browser (use a local static server for CORS if needed)
