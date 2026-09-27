# Garden Planner v2

**Live:** https://nokill-pedal-co.github.io/garden-planner/ (GitHub Pages from `main`, root folder).

Pixel-art garden planner PWA. Clean rebuild of v1 (`../index.html`, kept as legacy).
Design notes: [ARCHITECTURE.md](ARCHITECTURE.md).

- **Yard** — top-down pixel map of the lot; beds you can drag/rotate (Arrange); optional pixelated satellite photo underlay.
- **Beds** — per-bed editor: seed box palette, tap-to-place, drag to move, spacing rings, companion/rotation warnings, capacity meter, unplaced tray.
- **Almanac** — frost countdown, *This week* tasks (sow / transplant / harvest / succession / frost), season Gantt, sowing calendar; one-tap Google Calendar links.
- **Library** — ~100+ plants tuned for zone 8b with windows, spacing, companions, your own notes.
- **Log** — harvests + notes, per-crop season totals.
- Offline-first: works with no signal; edits queue and sync when back online. Realtime sync across devices.

## Run locally

No build step, no `node_modules`. Any static server works:

```bash
python tools/serve.py 5173
```

Then open http://localhost:5173/. Without Supabase config it runs in offline mode (data in this browser only).

Tests (Node 24, no dependencies):

```bash
node --test "tests/*.test.mjs"
```

Regenerate app icons after changing the `icon_sprout` sprite: `node tools/make-icons.mjs`.

## Supabase setup (one time)

1. Create a project at supabase.com (free tier is plenty).
2. SQL Editor → paste all of `supabase/schema.sql` → Run. It is idempotent; re-run after updates.
3. Authentication → URL Configuration: set **Site URL** to where the app is hosted, and add it
   (plus `http://127.0.0.1:5173/` for local dev) to **Redirect URLs**.
4. Project Settings → API: copy the **Project URL** and the **publishable/anon key** into `js/config.js`.
5. Open the app, sign in with a magic link, choose **Import v1 garden** and pick `../garden-db.json`.

Free-tier projects pause after ~7 days with no traffic; the app pings on every open. If the garden
goes quiet in winter, restore the project from the dashboard.

## Deploy

It's a static folder: GitHub Pages, Netlify, Cloudflare Pages, or anything else. After deploying,
add the URL to Supabase's Redirect URLs (step 3). Bump `VERSION` in `sw.js` when shipping so
installed copies pick up the new files.
