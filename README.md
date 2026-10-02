# JobPing 🔔

**Be the first to apply.** Tell JobPing what roles you want — it watches job boards on your schedule, scores every posting against *your resume* ATS-style, and pings you the moment a great match appears.

![JobPing matches dashboard](screenshots/matches.jpg)

## ✨ Features

- **ATS-style resume matching** — every job scored 0–100 by how much of *its* keywords appear in *your* resume, with a tap-to-open breakdown of matched vs. missing terms
- **7 job sources** — 5 free out of the box (Arbeitnow, Remotive, The Muse, Jobicy, RemoteOK) + Adzuna and JSearch (aggregates LinkedIn / Indeed / Glassdoor) via your own free API keys
- **Strict title & location filters** — "Financial Analyst" never shows "Data Analyst" roles; "New York" never shows worldwide noise
- **Remote / hybrid / on-site, sponsorship & experience-level filters**
- **Email digests** — free Web3Forms key, 30-second guided setup in the app
- **Apply prep mode** — one-tap packets with the application link, your resume, saved answers & cover letters. You always submit yourself — nothing auto-applies, ever
- **100% private** — no accounts, no server. Everything lives in your browser's localStorage

![Score breakdown](screenshots/score-breakdown.jpg)

## 🛠 set-up

No build step, no dependencies — it's a static page.

1. Clone the repo
   ```
   git clone https://github.com/<you>/jobping.git
   cd jobping
   ```
2. Open `index.html` in your browser (or `python3 -m http.server`)
3. Tell JobPing your titles, level & location — matches start rolling in

Or open `jobping-standalone.html` — the whole app in one file.

## 🚀 deploy

Push to GitHub → Settings → Pages → Deploy from branch → `main` / root. Live at `https://<you>.github.io/jobping/`.

## 🧪 tests

```
node test/test-logic.js   # 119 logic assertions
node test/test-e2e.js     # headless-Chromium E2E incl. strict-title/location filters, fresh-session refresh, mobile overflow
```

## 🎨 color codes

| Color | Hex |
| --- | --- |
| Accent blue | `#2f6bff` |
| Ink | `#0d1b33` |
| Success green | `#0f9d76` |
| Background | `#edf1f8` |

## 🗂 repo layout

| File | What |
| --- | --- |
| `index.html` | App shell + all views |
| `styles.css` | All styling (mobile-first) |
| `app.js` | UI, checks, alerts, history, prep packets |
| `logic.js` | Pure logic: scoring, sources, normalization (tested) |
| `jobping-standalone.html` | Single-file build of the whole app |
| `test/` | Logic + E2E tests |
| `screenshots/` | README screenshots |

## ⚠️ honest limitations

- **Web page, not a server.** Checks and email digests run while the app is open. True 24/7 alerting needs a hosted backend (not included).
- **No LinkedIn/Indeed scraping** — violates their ToS and risks your account. JSearch (optional free key) aggregates them legitimately.
- **Scores are an ATS-style estimate** — not any employer's actual ATS. Always read the posting.
- **Close → reopen** always lands on Home and refreshes data, so you never stare at stale matches.

---

*Independent concept project. Not affiliated with any employer or job board.*
