/**
 * build-venezuela-map.mjs
 * -----------------------------------------------------------------------------
 * Genera el GeoJSON compacto que se incrusta en index.html para el mapa
 * interactivo de Venezuela (25 entidades federales + Estado Guayana Esequiba).
 *
 * Fuentes:
 *  - Estados: ven-states.json (GADM 4.1, vía repositorio público de mapas de
 *    Venezuela). Se renombran a los nombres usados por el panel INTi-FAO.
 *    https://raw.githubusercontent.com/diazpolanco13/venezuela-strategic-map/main/public/geo/ven-states.json
 *  - Guayana Esequiba: polígono del territorio al oeste del río Esequibo
 *    (Zona en Reclamación, Acuerdo de Ginebra de 1966).
 *    https://raw.githubusercontent.com/diazpolanco13/venezuela-strategic-map/main/src/config/esequibo.ts
 *
 * Uso:
 *  node tools/build-venezuela-map.mjs <ven-states.json> <esequibo.ts> [salida.json] [tolerancia]
 *
 * El resultado es un FeatureCollection con:
 *  properties.n  nombre visible
 *  properties.d  clave de datos en statesData (null = sin ORT / sin datos)
 *  properties.p  centro de etiqueta [lng, lat]
 *  properties.c  "claim" cuando es territorio en reclamación
 *  geometry      MultiPolygon simplificado
 */
import fs from 'node:fs';

const [, , statesPath, esequiboPath, outPath, tolArg] = process.argv;
if (!statesPath || !esequiboPath) {
  console.error('Uso: node tools/build-venezuela-map.mjs <ven-states.json> <esequibo.ts> [salida.json] [tolerancia]');
  process.exit(1);
}

const TOLERANCE = Number(tolArg) || 0.002; // grados (~220 m). Suficiente a escala nacional.
const ROUND = 4;         // decimales (~11 m)
const MIN_AREA = 2e-6;   // descarta cayos menores a ~0.02 km²

/** Nombres GADM -> nombre del panel + clave de datos */
const NAME_MAP = {
  Amazonas: ['Amazonas', 'Amazonas'],
  Anzoátegui: ['Anzoátegui', 'Anzoátegui'],
  Apure: ['Apure', 'Apure'],
  Aragua: ['Aragua', 'Aragua'],
  Barinas: ['Barinas', 'Barinas'],
  Bolívar: ['Bolívar', 'Bolívar'],
  Carabobo: ['Carabobo', 'Carabobo'],
  Cojedes: ['Cojedes', 'Cojedes'],
  DeltaAmacuro: ['Delta Amacuro', 'Delta Amacuro'],
  DependenciasFederales: ['Dependencias Federales', null],
  DistritoCapital: ['Distrito Capital', 'Distrito Capital'],
  Falcón: ['Falcón', 'Falcón'],
  Guárico: ['Guárico', 'Guárico'],
  Lara: ['Lara', 'Lara'],
  Mérida: ['Mérida', 'Mérida'],
  Miranda: ['Miranda', 'Miranda'],
  Monagas: ['Monagas', 'Monagas'],
  NuevaEsparta: ['Nueva Esparta', 'Nueva Esparta'],
  Portuguesa: ['Portuguesa', 'Portuguesa'],
  Sucre: ['Sucre', 'Sucre'],
  Táchira: ['Táchira', 'Táchira'],
  Trujillo: ['Trujillo', 'Trujillo'],
  Vargas: ['La Guaira', 'La Guaira'],
  Yaracuy: ['Yaracuy', 'Yaracuy'],
  Zulia: ['Zulia', 'Zulia'],
};

/* ------------------------------ utilidades ------------------------------- */

const round = (n) => Number(n.toFixed(ROUND));

function ringArea(coords) {
  let a = 0;
  for (let i = 0, n = coords.length - 1; i < n; i++) {
    a += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(a / 2);
}

function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** Douglas-Peucker iterativo */
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToRing(pt, ring) {
  let min = Infinity;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    min = Math.min(min, perpDistance(pt, ring[i], ring[i + 1]));
  }
  return min;
}

/** Centro "visual" (pole of inaccessibility aproximado) del polígono mayor */
function labelCenter(polygons) {
  let big = polygons[0];
  let bigArea = 0;
  for (const poly of polygons) {
    const a = ringArea(poly[0]) * Math.cos((poly[0][0][1] * Math.PI) / 180);
    if (a > bigArea) {
      bigArea = a;
      big = poly;
    }
  }
  const ring = big[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const steps = 28;
  let best = null;
  let bestScore = -1;

  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const pt = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (!pointInRing(pt, ring)) continue;
      const score = distToRing(pt, ring);
      if (score > bestScore) {
        bestScore = score;
        best = pt;
      }
    }
  }
  if (!best) best = [(minX + maxX) / 2, (minY + maxY) / 2];
  return [round(best[0]), round(best[1])];
}

/** Normaliza un anillo: cierra, simplifica y redondea */
function processRing(ring) {
  let pts = ring.map(([x, y]) => [round(x), round(y)]);
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) pts.pop();
  }
  // Elimina duplicados consecutivos
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length < 3) return null;
  const area = ringArea([...pts, pts[0]]);
  const tol = area > 0.02 ? TOLERANCE : TOLERANCE / 4;
  let simplified = simplify(pts, tol);
  if (simplified.length < 3) return null;
  simplified = simplified.map(([x, y]) => [round(x), round(y)]);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([first[0], first[1]]);
  return simplified;
}

function processPolygon(poly) {
  const rings = [];
  for (let i = 0; i < poly.length; i++) {
    const processed = processRing(poly[i]);
    if (!processed) continue;
    if (i > 0 && ringArea(processed) < MIN_AREA) continue;
    rings.push(processed);
  }
  if (!rings.length) return null;
  return rings;
}

function bboxOf(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [round(minX), round(minY), round(maxX), round(maxY)];
}

/* ------------------------------- entrada --------------------------------- */

const states = JSON.parse(fs.readFileSync(statesPath, 'utf8'));

const eseSource = fs.readFileSync(esequiboPath, 'utf8');
const coordsMatch = eseSource.match(/coordinates:\s*(\[\[[\s\S]*?\]\])\s*,?\s*\}/);
if (!coordsMatch) throw new Error('No se pudo extraer el polígono de Guayana Esequiba');
const esequiboPolygon = JSON.parse(coordsMatch[1].replace(/,\s*([\]}])/g, '$1'));

/* ------------------------------- procesado ------------------------------- */

const features = [];

for (const feature of states.features) {
  const rawName = feature.properties.NAME_1;
  const mapped = NAME_MAP[rawName];
  if (!mapped) {
    console.warn('Nombre sin mapear:', rawName);
    continue;
  }
  const [name, dataKey] = mapped;
  const geom = feature.geometry;
  const sourcePolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

  const polygons = sourcePolys
    .map(processPolygon)
    .filter(Boolean)
    .filter((poly) => ringArea(poly[0]) >= MIN_AREA)
    // Excluye islas muy alejadas al norte (Isla de Aves, 15,7° N): recortan el encuadre
    .filter((poly) => poly[0].some((p) => p[1] < 13));

  if (!polygons.length) continue;

  features.push({
    type: 'Feature',
    properties: {
      n: name,
      d: dataKey,
      p: labelCenter(polygons),
      b: bboxOf(polygons),
      o: 0,
    },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  });
}

// Estado Guayana Esequiba (territorio al oeste del río Esequibo)
const esePolygons = [processPolygon(esequiboPolygon)].filter(Boolean);
features.push({
  type: 'Feature',
  properties: {
    n: 'Guayana Esequiba',
    d: 'Guayana Esequiba',
    p: labelCenter(esePolygons),
    b: bboxOf(esePolygons),
    o: 1,
    c: 1,
  },
  geometry: { type: 'MultiPolygon', coordinates: esePolygons },
});

/* Orden de dibujo: entidades pequeñas al final para que queden encima */
features.sort((a, b) => {
  const areaA = ringArea(a.geometry.coordinates[0][0]);
  const areaB = ringArea(b.geometry.coordinates[0][0]);
  return areaB - areaA;
});

const collection = { type: 'FeatureCollection', features };
const json = JSON.stringify(collection);
if (outPath) {
  fs.writeFileSync(outPath, json, 'utf8');
  console.error(`OK ${features.length} features, ${json.length} bytes -> ${outPath}`);
} else {
  process.stdout.write(json);
}
