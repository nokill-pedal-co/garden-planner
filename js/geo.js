// Feet <-> lat/lng and small polygon helpers. Pure: runs in Node and the browser.
// Garden coordinates: +x east, +y south (screen-down), feet from the garden origin.
// Bed x_ft/y_ft is the bed's CENTRE; rotation is clockwise degrees.

const FT_PER_DEG_LAT = 364_000;

export function ftPerDegLng(lat) {
  return FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function toLatLng(origin, x, y) {
  return {
    lat: origin.lat - y / FT_PER_DEG_LAT,
    lng: origin.lng + x / ftPerDegLng(origin.lat),
  };
}

export function fromLatLng(origin, lat, lng) {
  return {
    x: (lng - origin.lng) * ftPerDegLng(origin.lat),
    y: (origin.lat - lat) * FT_PER_DEG_LAT,
  };
}

export function rotate([x, y], deg, [cx, cy] = [0, 0]) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - cx, dy = y - cy;
  // y points down, so a positive angle turns clockwise on screen.
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** Corners of a bed in garden feet, clockwise from its top-left. */
export function bedCorners(bed) {
  const hl = bed.length_ft / 2, hw = bed.width_ft / 2;
  const cx = bed.x_ft, cy = bed.y_ft;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
    .map(([dx, dy]) => rotate([cx + dx, cy + dy], bed.rotation_deg || 0, [cx, cy]));
}

/**
 * Outline of a structure: { x, y, w, h, rotation, points? }. Same centre-based model as beds;
 * `points` (optional) is a polygon in unrotated local feet around the centre, e.g. a building
 * footprint from OpenStreetMap. w/h are its bounding box.
 */
export function structureCorners(s) {
  if (s.points?.length) return s.points.map(([px, py]) => rotate([s.x + px, s.y + py], s.rotation || 0, [s.x, s.y]));
  return bedCorners({ x_ft: s.x, y_ft: s.y, length_ft: s.w, width_ft: s.h, rotation_deg: s.rotation || 0 });
}

/** Resize a structure's bounding box to w x h, scaling its polygon to match (local frame). */
export function scaleStructure(s, w, h) {
  if (!s.points?.length) return { w, h };
  const kx = w / s.w, ky = h / s.h;
  return { w, h, points: s.points.map(([px, py]) => [round2(px * kx), round2(py * ky)]) };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** A point inside a bed (bed-local feet, origin top-left) -> garden feet. */
export function bedToGarden(bed, x, y) {
  const lx = bed.x_ft - bed.length_ft / 2 + x;
  const ly = bed.y_ft - bed.width_ft / 2 + y;
  return rotate([lx, ly], bed.rotation_deg || 0, [bed.x_ft, bed.y_ft]);
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function bbox(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function pointInPolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Outline of a bed in garden feet: its 4 corners, or a 32-gon for round beds and pots. */
export function bedOutline(bed) {
  if (bed.shape !== 'round') return bedCorners(bed);
  const rx = bed.length_ft / 2, ry = bed.width_ft / 2, n = 32;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(rotate([bed.x_ft + rx * Math.cos(a), bed.y_ft + ry * Math.sin(a)], bed.rotation_deg || 0, [bed.x_ft, bed.y_ft]));
  }
  return pts;
}

// ------------------------------------------------------------ pots

// Typical fabric/nursery pot diameters (inches) by nominal gallons. Heights run ~0.8 x diameter.
export const POT_SIZES = [[1, 7], [2, 8], [3, 10], [5, 12], [7, 14], [10, 16], [15, 18], [20, 20], [25, 21], [30, 24], [45, 26], [65, 30], [100, 36]];

/** Diameter and height (feet) for a pot of `gal` gallons; interpolates between standard sizes. */
export function potDims(gal) {
  const g = Math.max(POT_SIZES[0][0], Math.min(POT_SIZES.at(-1)[0], gal || 5));
  let d = POT_SIZES[0][1];
  for (let i = 1; i < POT_SIZES.length; i++) {
    const [g0, d0] = POT_SIZES[i - 1], [g1, d1] = POT_SIZES[i];
    if (g <= g1) { d = d0 + ((g - g0) / (g1 - g0)) * (d1 - d0); break; }
  }
  const dia = Math.round((d / 12) * 100) / 100;
  return { diameter_ft: dia, height_ft: Math.round(dia * 0.8 * 100) / 100 };
}

// ------------------------------------------------------------ plant layout

/**
 * Bed-local positions of each individual plant in a planting. Uses `planting.positions` when set;
 * otherwise lays `qty` plants in rows from (x_ft, y_ft) at `spacingFt`, wrapping inside the bed.
 */
export function unitPositions(planting, bed, spacingFt) {
  const n = Math.max(1, planting.qty || 1);
  const saved = Array.isArray(planting.positions) ? planting.positions.slice(0, n) : [];
  if (saved.length === n) return saved;
  const out = [...saved];
  const s = Math.max(0.25, spacingFt || 1);
  const x0 = planting.x_ft ?? s / 2, y0 = planting.y_ft ?? s / 2;
  const perRow = Math.max(1, Math.floor((bed.length_ft - x0 + s / 2) / s));
  for (let i = out.length; i < n; i++) {
    const col = i % perRow, row = Math.floor(i / perRow);
    out.push([
      Math.min(bed.length_ft, round2(x0 + col * s)),
      Math.min(bed.width_ft, round2(y0 + row * s)),
    ]);
  }
  return out;
}

/**
 * A bed that holds a single plant and moves as one with it: a pot, or a round in-ground patch
 * such as a blueberry bush. The plant stays centred; you move the bed, not the plant.
 */
export function isSolo(bed) {
  return bed?.kind === 'container' || (bed?.kind === 'ground' && bed?.shape === 'round');
}
