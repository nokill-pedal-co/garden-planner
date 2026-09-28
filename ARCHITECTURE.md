# Garden Planner v2 — architecture

Clean rebuild of the v1 single-file PWA (`../index.html`, left untouched as legacy).

## Principles
- **No build step.** Plain ES modules loaded by the browser. Third-party libs come from CDNs
  (Leaflet from unpkg, supabase-js from jsdelivr `+esm`). No `node_modules` — this folder lives
  in Google Drive and syncs to every device.
- **Pure logic is DOM-free** so it runs under `node --test` (Node 24, no deps): `js/plants.js`,
  `js/season.js`, `js/importer.js`, `js/geo.js`, and the *data* half of `js/sprites.js`.
- **Supabase is the source of truth** (auth: magic link; Postgres + RLS; realtime). The client
  keeps the whole garden in memory, caches it in localStorage for offline start, and queues
  writes in an outbox when offline. Client-generated UUIDs make every write an idempotent upsert.
- **Local mode**: with no Supabase config (or "try without an account") everything runs against
  localStorage via the same store API. Signing in later offers to push the local garden up.
- **Pixel look**: 16×16 sprites drawn from ASCII grids, rendered to canvas once, scaled with
  `image-rendering: pixelated`. Pixel fonts (Pixelify Sans, Silkscreen). Hard 2px borders, stepped
  drop shadows, no border-radius, no gradients.

## Layout
```
v2/
  index.html            app shell
  manifest.webmanifest  PWA manifest
  sw.js                 service worker (app shell + CDN libs, network-first for HTML)
  css/app.css           pixel theme
  js/
    config.js           SUPABASE_URL / SUPABASE_ANON_KEY (publishable, safe to ship)
    main.js             boot, router, top-level UI chrome
    store.js            in-memory state + pub/sub + mutations (the only writer)
    sync.js             Supabase + localStorage cache + outbox
    plants.js           plant library + name matching           (pure)
    season.js           frost dates, sowing windows, tasks       (pure)
    geo.js              feet <-> lat/lng, polygons, rotation      (pure)
    importer.js         v1 garden-db.json / v1 export -> v2 rows  (pure)
    sprites.js          sprite data (pure) + spriteURL() renderer (DOM, lazy)
    ui.js               tiny DOM helpers, modal, toast
    views/
      yard.js           pixel top-down yard (beds on lot) + pixelated satellite photo underlay (Esri tiles, no Leaflet)
      bed.js            bed editor: drag plants from palette onto a 1ft/6in grid
      almanac.js        This Week tasks + season timeline
      library.js        plant library browser
      log.js            harvest + notes log
      auth.js           sign-in screen
      settings.js       garden settings, frost dates, import/export
  supabase/schema.sql   tables, RLS, triggers, realtime publication
  tests/*.test.mjs      node --test
```

## Coordinates
Everything in the app is in **feet**. A garden has an origin (`origin_lat`, `origin_lng`); yard
positions are `(x_ft, y_ft)` of the bed's CENTRE with +x = east, +y = south (screen-down), and `rotation_deg`
clockwise. A bed's own grid has its origin at the bed's top-left corner, x along `length_ft`,
y along `width_ft`. Plantings store `x_ft`,`y_ft` inside their bed (the plant's centre).

## Data model (Postgres, see supabase/schema.sql)
- `gardens` — name, zone, last_frost/first_frost ('MM-DD'), origin lat/lng, lot polygon + structures (jsonb, feet), is_public.
- `garden_members` — (garden_id, user_id, role owner|editor|viewer). RLS keys off this.
- `beds` — kind raised|container|ground|tray|plan, area label, L×W×H ft, x/y/rotation, color, sort, archived.
- `plantings` — plant_key (library) + variety, qty, bed_id (nullable = unplaced/planned), x/y ft,
  status planned|started|planted|harvesting|done|failed, season (year), method direct|transplant|start|perennial,
  dates: sow_date, transplant_date, expected_harvest, done_date; source, notes, locked.
- `events` — type harvest|note|task, date, planting_id?, bed_id?, plant_key?, amount, unit, text, meta.
- `custom_plants` — per-garden additions/overrides to the library (jsonb in the same shape as PLANTS).

## Module contracts

### plants.js (pure)
```js
export const DEFAULT_CLIMATE = { place, zone: '8b', lastFrost: '04-15', firstFrost: '10-25' };
export const CATEGORIES = [{ key, name }];
export const PLANTS = [{
  key, name, category, family,        // family: brassica|solanaceae|cucurbit|legume|allium|umbellifer|
                                      //   amaranth|aster|lamiaceae|rosaceae|ericaceae|moraceae|other
  sprite, tint,                       // sprite key from sprites.js; tint {A,B} hex overrides (optional)
  days, daysFrom,                     // days to first harvest; counted from 'sow' or 'transplant'
  harvestDays,                        // length of harvest window once ready
  spacingIn,                          // in-row spacing in inches (square-foot style footprint)
  hardiness,                          // tender | half-hardy | hardy
  perennial,                          // bool
  windows: {                          // weeks relative to LAST frost (negative = before); fall is
    indoors?: [from, to],             //   weeks relative to FIRST frost (negative = before)
    transplant?: [from, to],
    direct?: [from, to],
    fall?: [from, to],                // direct/transplant for a fall crop
  },
  succession,                         // days between sowings, or null
  companions: [key|'family:x'], avoid: [key|'family:x'],
  aliases: [string],                  // extra names for matching
  notes,
}];
export function getPlant(key, custom?);          // falls back to a generic 'unknown' plant
export function allPlants(custom?);
export function findPlantByName(name, custom?);  // -> { plant, variety } | null. Variety entries carry `base` (generic key).
```

### sprites.js
Data half importable in Node (no DOM at module top level).
```js
export const PALETTE;                 // char -> hex
export const SPRITES;                 // key -> { rows: string[16] } (16x16)
export function spriteURL(key, tint?) // -> PNG data URL at native 16x16, cached per key+tint
export function spriteCanvas(key, tint?, scale?)
```
Sprite keys used by the app (must exist): see the list in the header of `js/sprites.js`.

### season.js (pure; dates are 'YYYY-MM-DD' strings, local calendar dates)
```js
frostDates(climate, year) -> { lastFrost: Date-string, firstFrost }
sowingWindows(plant, climate, year) -> [{ type, start, end }]
expectedHarvest(planting, plant) -> 'YYYY-MM-DD' | null
progress(planting, plant, today) -> { stage, pct, daysLeft }
weeklyTasks({ plantings, beds, climate, custom }, today) -> [{ kind, title, detail, date, plantingId?, plantKey?, priority }]
companionIssues(bedPlantings, custom?) -> [{ a, b, kind: 'avoid'|'companion' }]
rotationIssues(bed, plantings, season) -> [...]
bedCapacity(bed, plantings, custom?) -> { usedSqFt, areaSqFt, pct }
```

## Supabase project
- Project `garden-planner` (ref `unobfrradopjdkfrddll`, West US / Oregon), org NOKILL Pedal Co.
- Schema: `supabase/schema.sql` (idempotent). Apply: `npx supabase db query --linked --project-ref unobfrradopjdkfrddll -f supabase/schema.sql`.
- Security-definer access helpers live in the `private` schema (not exposed via the API). One RLS policy per table+action. Security advisor: clean.
- Auth URLs: `supabase/config.toml` -> `npx supabase config push --project-ref unobfrradopjdkfrddll` (only declared keys change).
- DB password: `~/.supabase/garden-planner-db-password.txt` on the temp laptop (not in Drive).
- Sync: outbox batches consecutive upserts per table (<=200 rows/request); a failing batch retries its first row alone and drops it if rejected.

## Onboarding by address (planned — needed before other users / subscriptions)
Goal: a new user types their address and gets a ready-made yard. Pipeline, all free/public data:
1. **Geocode** the address → lat/lng (US Census geocoder or Nominatim) → `gardens.origin_lat/lng`.
2. **Frost dates + zone** from the location (NOAA climate-normal frost dates / USDA zone by ZIP) → `last_frost`, `first_frost`, `zone`.
3. **Buildings** from OpenStreetMap Overpass (`way["building"](around:60,lat,lng)`), converted to garden feet and stored as polygon
   structures (`points`). Pick the one tagged with the matching `addr:housenumber` as "House"; small ones nearby as sheds.
   Verified 2026-09-27: OSM has Alex's house + shed footprints (ways 328703294, 977458140) and they match the photo.
   Fallback when OSM is missing: Microsoft US Building Footprints.
4. **Lot boundary** from county tax-lot GIS where available (e.g. Metro RLIS / Washington County taxlots), else let the user
   draw it on the photo. Driveways/paths: user adds via "+ House / path" over the photo layer.
Structures already support polygons (`structureCorners`, `scaleStructure` in geo.js), so steps 1–3 just write data.
Overpass/Nominatim have usage policies (low volume, identify the app) — run lookups once per garden, cache results.
