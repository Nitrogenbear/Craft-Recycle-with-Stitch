# Craft, Recycle with Stitch — Job Manager

A local-first web app for Carla's alterations, repairs, made-to-measure and upcycling jobs.
All data is stored in the browser on the device (IndexedDB). There is no server and no account, and it works offline.

**Open the app:** <https://nitrogenbear.github.io/Craft-Recycle-with-Stitch/>
On a tablet or phone, open the link, then use **Add to Home Screen** (Safari: Share button; Chrome: ⋮ menu) to install it like an app.
Every push to `main` rebuilds and republishes it automatically (`.github/workflows/deploy.yml`), and Carla's saved jobs are not affected.

## Run it locally

```bash
npm install
npm run dev        # development, http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

`dist/` is a plain static site. Host it anywhere that serves HTTPS, such as Netlify, Cloudflare Pages or GitHub Pages, and open it on the workshop tablet.
After the first visit, a service worker caches the app so it still opens without internet.
On a tablet, use **Add to Home Screen** so it opens like an app.

> Data lives **per browser, per device**. Use *Settings → Download full backup* regularly. The Google Sheet is a second copy for reporting, not a full backup.

## What's in it

| Spec item | Where |
|---|---|
| Job entry, client details, auto ticket numbers (`CRS-0001`, editable) | **+ New job** |
| Returning clients: typing a known name fills in their details | New job form |
| Per-garment start/stop timers (system clock, survive reloads) | Job page |
| Manual time entry, editable time log, longest-garment highlight | Job page → *+ Add time* / *Log* |
| Hand-back queue (soonest first), waiting-for-pickup list, status tiles, jobs this week, avg turnaround | Dashboard |
| Sortable/filterable job list, history filter for completed jobs | Jobs |
| Yellow = due within 2 days, red = overdue, blue = new, green = on track | Everywhere, plus the ⚠ count in the header |
| To-do list: priorities, due dates, link to a job, Today view | To-do, and on the dashboard and job pages |
| Completion screen: big phone/email, best time to call, copy, call/text/WhatsApp/email, quick notes | Opens when you complete a garment or mark a job ready |
| CSV exports: job list, time log (date range), completed jobs by month, weekly/monthly summaries | Settings |
| Google Sheets: auto-append on *Completed*, manual sync, full push with summaries, choose columns | Settings |
| Light / dark / match-device theme | Settings |

Behaviour notes:
- Only one timer runs at a time. Starting another garment's timer stops the current one.
- Starting a timer moves a *New* job to *In Progress*.
- *Ready for Pickup* stops timers and sets the finish date. *Completed* (collected) is what syncs to Sheets.
- Completed jobs are hidden from the active list. Use the **History** filter to see them.

## Google Sheets setup (once, about 10 minutes)

The app uses Google's browser sign-in and only the `drive.file` scope, so it can only see the spreadsheet it creates.

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Stitch Jobs").
2. **APIs & Services → Library**: enable the **Google Sheets API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and email, and add Carla's Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised JavaScript origins: the address the app runs at, `https://nitrogenbear.github.io` (plus `http://localhost:5173` for local testing)
5. Copy the **Client ID** (`…apps.googleusercontent.com`) into **Settings → Google Sheets backup** and click **Connect Google & create sheet**.

The sheet gets four tabs: *Completed Jobs* (one row is appended per job), *All Jobs*, *Weekly Summary* and *Monthly Summary* (the last three are refreshed by *Push all jobs + summaries*).
If a sync fails, for example while offline, the jobs stay marked as unsynced and go up on the next sync.

## Code map

```
src/
  App.jsx          routing, all state-changing actions, Sheets auto-sync
  store.js         IndexedDB persistence (+ localStorage fallback)
  util.js          dates, durations, deadline colours
  reports.js       CSV + sheet row builders, summaries
  sheets.js        Google Identity Services + Sheets API
  demo.js          sample data (Settings → Load sample jobs)
  views/           Dashboard, Jobs, JobDetail, JobForm, ContactPanel, Tasks, TaskList, Settings
public/sw.js       offline cache
```

## Phase 2 ideas from the spec (not built)
Invoicing, photo upload, client portal, multiple users, analytics charts, and SMS/email reminders.
Multiple users or devices need a backend. The store is a single JSON document, so it would move to SQLite or Postgres behind an API without much change.
