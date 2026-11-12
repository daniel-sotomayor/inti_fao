/**
 * build-predios-layers.cjs
 * -----------------------------------------------------------------------------
 * Convierte caca.geojson (970 MB / 536.369 predios) en capas compactas para el
 * visor INTi-FAO:
 *
 *   predios/manifest.js      Metadatos por estado (conteo, superficie, archivo)
 *   predios/<estado>.js      Predios de un estado (geometría simplificada + ficha)
 *   predios/densidad.js      Cuadrícula nacional de densidad (conteo por celda)
 *
 * Formato de cada predio (array compacto):
 *   [id, nombre, area_ha, iSujeto, iEstatus, iTipo, anio, iMunicipio,
 *    iParroquia, solicitante, geometria]
 *
 * La geometría se codifica con el algoritmo "polyline" de Google (5 decimales,
 * ~1 m) y se simplifica con Douglas-Peucker (~9 m). Los anillos múltiples se
 * separan con ";" y se dibujan con regla par-impar (permite huecos).
 *
 * Uso:
 *   node tools/build-predios-layers.cjs caca.geojson predios [tolerancia]
 *   node tools/build-predios-layers.cjs caca.geojson predios 0.00008 Zulia
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const input = process.argv[2] || 'caca.geojson';
const outDir = process.argv[3] || 'predios';
const TOLERANCE = Number(process.argv[4]) || 0.00008;
const ONLY_STATE = process.argv[5] || null;

const PRECISION = 1e5;
const DENSITY_STEP = 0.05;
const ENVELOPE = { minLng: -73.6, maxLng: -59.4, minLat: 0.5, maxLat: 12.6 };
const BBOX_PAD = 0.05;

// Límites por estado tomados del GeoJSON que usa el visor (index.html)
const STATE_BBOX = new Map();
try {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script id="veMapData"[^>]*>([\s\S]*?)<\/script>/);
  if (match) {
    const geo = JSON.parse(match[1]);
    for (const f of geo.features) {
      if (f.properties && f.properties.b && f.properties.n) {
        STATE_BBOX.set(f.properties.n, f.properties.b);
      }
    }
  }
  console.log(`Límites de ${STATE_BBOX.size} entidades cargados desde index.html`);
} catch (e) {
  console.warn('Aviso: no se pudo leer index.html, se omite el filtro por estado');
}

const SUJETOS = [];
const ESTATUS = [];
const TIPOS = [];
const MUNICIPIOS = new Map();
const PARROQUIAS = new Map();

const STATES = new Map(); // estado -> { features: [] }
const DENSITY = new Map(); // "ix,iy" -> { count, area }
let skippedOutside = 0;
let skippedWrongState = 0;
let skippedInvalid = 0;
let total = 0;
let totalPointsOut = 0;
let totalPointsIn = 0;

const pad2 = (n) => String(n).padStart(2, '0');

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function idx(arr, value) {
  let i = arr.indexOf(value);
  if (i === -1) { i = arr.length; arr.push(value); }
  return i;
}

function dictIndex(map, value) {
  const key = String(value || '').trim() || '—';
  if (map.has(key)) return map.get(key);
  const i = map.size;
  map.set(key, i);
  return i;
}

/* ----------------------- simplificación geométrica ----------------------- */

function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

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
      if (d > maxDist) { maxDist = d; index = i; }
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

/* --------------------------- codificación polyline ----------------------- */

function encodeNumber(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of points) {
    const iLat = Math.round(lat * PRECISION);
    const iLng = Math.round(lng * PRECISION);
    out += encodeNumber(iLat - prevLat) + encodeNumber(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

/* ------------------------------ procesado -------------------------------- */

function processRing(ring) {
  if (ring.length < 4) return null;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  let pts = closed ? ring.slice(0, -1) : ring.slice();
  // Elimina duplicados consecutivos
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length < 3) return null;

  // Simplifica; conserva siempre el cierre
  let simplified = simplify([...pts, pts[0]], TOLERANCE);
  if (simplified.length < 4) {
    simplified = [pts[0], pts[1], pts[2], pts[0]];
  } else if (simplified[0][0] !== simplified[simplified.length - 1][0] ||
             simplified[0][1] !== simplified[simplified.length - 1][1]) {
    simplified.push(simplified[0]);
  }
  return simplified;
}

const rl = readline.createInterface({
  input: fs.createReadStream(input, { encoding: 'utf8' }),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (!line.startsWith('{ "type": "Feature"')) return;
  let f;
  try {
    f = JSON.parse(line.replace(/,\s*$/, ''));
  } catch (e) {
    skippedInvalid++;
    return;
  }
  const p = f.properties || {};
  const estado = String(p.estado || '').trim();
  if (!estado) { skippedInvalid++; return; }
  if (ONLY_STATE && estado !== ONLY_STATE) return;

  const geom = f.geometry;
  if (!geom || !geom.coordinates || !geom.coordinates.length) { skippedInvalid++; return; }

  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const rings = [];
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  for (const poly of polys) {
    for (const ring of poly) {
      totalPointsIn += ring.length;
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      const processed = processRing(ring);
      if (processed) rings.push(processed);
    }
  }
  if (!rings.length) { skippedInvalid++; return; }

  // Descarta geometrías fuera del territorio nacional (errores de digitalización)
  const cLng = (minLng + maxLng) / 2;
  const cLat = (minLat + maxLat) / 2;
  if (cLng < ENVELOPE.minLng || cLng > ENVELOPE.maxLng || cLat < ENVELOPE.minLat || cLat > ENVELOPE.maxLat) {
    skippedOutside++;
    return;
  }

  // Descarta predios cuya geometría cae fuera de su propia entidad federal
  const stateBox = STATE_BBOX.get(estado);
  if (stateBox) {
    if (cLng < stateBox[0] - BBOX_PAD || cLat < stateBox[1] - BBOX_PAD ||
        cLng > stateBox[2] + BBOX_PAD || cLat > stateBox[3] + BBOX_PAD) {
      skippedWrongState++;
      return;
    }
  }

  // IMPORTANTE: el export tiene las columnas desplazadas:
  //   superficie -> nombre del predio
  //   sector     -> superficie en hectáreas
  //   direccion  -> sector / referencia
  const area = Number(p.sector);
  const nombre = String(p.superficie || '').trim() || `Predio ${p.id_predio}`;
  const anio = String(p['aÑo_solicitud'] || '').trim();
  const solicitante = String(p.nombre_de_solicitante || '').trim();

  const feature = [
    Number(p.id_predio) || 0,
    nombre,
    Number.isFinite(area) ? +area.toFixed(4) : 0,
    idx(SUJETOS, String(p.tipo_de_sujeto || '').trim() || '—'),
    idx(ESTATUS, String(p.estatus_de_solicitud || '').trim() || '—'),
    idx(TIPOS, String(p.tipo_de_solicitud || '').trim() || '—'),
    anio,
    dictIndex(MUNICIPIOS, p.municipio),
    dictIndex(PARROQUIAS, p.parroquia),
    solicitante,
    rings.map(encodePolyline).join(';')
  ];

  total++;
  totalPointsOut += rings.reduce((acc, r) => acc + r.length, 0);

  if (!STATES.has(estado)) STATES.set(estado, { features: [] });
  STATES.get(estado).features.push(feature);

  // Cuadrícula de densidad (centro del predio)
  const ix = Math.floor(cLng / DENSITY_STEP);
  const iy = Math.floor(cLat / DENSITY_STEP);
  const key = `${ix},${iy}`;
  const cell = DENSITY.get(key) || { count: 0, area: 0 };
  cell.count++;
  cell.area += Number.isFinite(area) ? area : 0;
  DENSITY.set(key, cell);

  if (total % 50000 === 0) console.log(`  ... ${total.toLocaleString('es-VE')} predios procesados`);
});

rl.on('close', () => {
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  const estadoList = [...STATES.keys()].sort((a, b) => a.localeCompare(b, 'es'));

  for (const estado of estadoList) {
    const data = STATES.get(estado);
    const file = `${slugify(estado)}.js`;
    const payload = {
      state: estado,
      count: data.features.length,
      area: +data.features.reduce((acc, f) => acc + f[2], 0).toFixed(2),
      sujetos: SUJETOS.slice(),
      estatus: ESTATUS.slice(),
      tipos: TIPOS.slice(),
      municipios: [...MUNICIPIOS.keys()],
      parroquias: [...PARROQUIAS.keys()],
      features: data.features
    };
    const js = `window.PREDIOS_LAYERS=window.PREDIOS_LAYERS||{};window.PREDIOS_LAYERS[${JSON.stringify(estado)}]=${JSON.stringify(payload)};\n`;
    fs.writeFileSync(path.join(outDir, file), js, 'utf8');
    manifest.push({
      state: estado,
      file,
      count: data.features.length,
      area: payload.area,
      size: Buffer.byteLength(js)
    });
    console.log(`${estado.padEnd(18)} ${String(data.features.length).padStart(7)} predios  ${(Buffer.byteLength(js) / 1024 / 1024).toFixed(2)} MB`);
  }

  // Cuadrícula de densidad: [ix, iy, count, area]
  const density = [...DENSITY.entries()].map(([key, v]) => {
    const [ix, iy] = key.split(',').map(Number);
    return [ix, iy, v.count, +v.area.toFixed(1)];
  });
  const densityPayload = {
    step: DENSITY_STEP,
    total,
    area: +[...DENSITY.values()].reduce((a, c) => a + c.area, 0).toFixed(2),
    cells: density
  };
  fs.writeFileSync(path.join(outDir, 'densidad.js'),
    `window.PREDIOS_DENSITY=${JSON.stringify(densityPayload)};\n`, 'utf8');

  fs.writeFileSync(path.join(outDir, 'manifest.js'),
    `window.PREDIOS_MANIFEST=${JSON.stringify({
      generated: new Date().toISOString(),
      total,
      area: +[...STATES.values()].reduce((a, s) => a + s.features.reduce((b, f) => b + f[2], 0), 0).toFixed(2),
      tolerance: TOLERANCE,
      states: manifest
    })};\n`, 'utf8');

  console.log('\nResumen');
  console.log('  predios exportados :', total.toLocaleString('es-VE'));
  console.log('  descartados fuera  :', skippedOutside);
  console.log('  descartados de otro estado:', skippedWrongState);
  console.log('  descartados inválidos:', skippedInvalid);
  console.log('  puntos entrada     :', totalPointsIn.toLocaleString('es-VE'));
  console.log('  puntos salida      :', totalPointsOut.toLocaleString('es-VE'));
  console.log('  celdas densidad    :', density.length.toLocaleString('es-VE'));
  console.log('  carpeta            :', path.resolve(outDir));
});
