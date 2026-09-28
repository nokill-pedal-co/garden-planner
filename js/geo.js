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
