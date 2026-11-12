/* =====================================================================
 * VISOR · REGISTRO AGRARIO  (visor-registro.js)
 * ---------------------------------------------------------------------
 * Integra el geoportal «GEOPORTAL_REGISTRO_SIN_INTERNET» dentro del visor
 * geográfico del Plan Venezuela Hambre Cero 2030 (INTi - FAO).
 *
 * Aporta al mapa que ya existe (#venezuelaMap):
 *   · Cobertura de la superficie registrada por región, estado y comuna.
 *   · Polígonos de registro: nacional (100 ha o más) y por estado/región,
 *     cargados bajo demanda desde GEOPORTAL_REGISTRO_SIN_INTERNET/datos/.
 *   · Filtros por tipo de sujeto, género, grupo de edad y año.
 *   · Tablero (KPI + barras) alimentado por el cubo agregado.
 *   · Teselas locales de OpenStreetMap (zooms 6-9) opcionales.
 *   · Recorrido guiado.
 *
 * No necesita servidor: sólo HTML, CSS y JS. En local conviene servirlo con
 * cualquier servidor estático (los fetch no funcionan con file://).
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Configuración                                                       */
  /* ------------------------------------------------------------------ */
  var GEO = 'GEOPORTAL_REGISTRO_SIN_INTERNET/';

  function crearRutas(base) {
    return {
      cubo: base + 'datos/cubo.json',
      regiones: base + 'datos/regiones.geojson',
      estados: base + 'datos/estados.geojson',
      comunas: base + 'datos/comunas.geojson',
      pais100: base + 'datos/predios/pais_100.geojson',
      predios: function (cod) { return base + 'datos/predios/' + cod + '.geojson'; },
      tiles: base + 'vendor/tiles/{z}/{x}/{y}.png'
    };
  }

  var RUTA = crearRutas(GEO);

  /* nivel de cobertura -> archivo de datos */
  var ARCHIVO_COBERTURA = { region: 'regiones', estado: 'estados', comuna: 'comunas' };

  var LIMA = [[0.6, -73.4], [12.2, -58.1]];

  /* El panel de filtros tapa el borde izquierdo del mapa: al encuadrar se
     reserva ese espacio para que el territorio quede a la vista. */
  var ENCUADRE = { paddingTopLeft: [286, 14], paddingBottomRight: [14, 14] };

  var TIPOS = ['Natural', 'Red', 'Jurídico'];

  var ESTADOS = [
    ['01', 'Distrito Capital'], ['02', 'Amazonas'], ['03', 'Anzoátegui'], ['04', 'Apure'], ['05', 'Aragua'],
    ['06', 'Barinas'], ['07', 'Bolívar'], ['08', 'Carabobo'], ['09', 'Cojedes'], ['10', 'Delta Amacuro'],
    ['11', 'Falcón'], ['12', 'Guárico'], ['13', 'Lara'], ['14', 'Mérida'], ['15', 'Miranda'], ['16', 'Monagas'],
    ['17', 'Nueva Esparta'], ['18', 'Portuguesa'], ['19', 'Sucre'], ['20', 'Táchira'], ['21', 'Trujillo'],
    ['22', 'Yaracuy'], ['23', 'Zulia'], ['24', 'La Guaira'], ['25', 'Territorio Insular'], ['26', 'Ezequibo']
  ];

  var REGIONES = [
    ['CENTRAL', 'Región Central', ['01', '05', '08', '15', '22', '24']],
    ['GUAYANA', 'Región Guayana', ['02', '07', '10']],
    ['LOS ANDES', 'Región Los Andes', ['14', '20', '21']],
    ['LOS LLANOS', 'Región Los Llanos', ['04', '06', '09', '12', '18']],
    ['OCCIDENTAL', 'Región Occidental', ['11', '13', '23']],
    ['ORIENTAL', 'Región Oriental', ['03', '16', '17', '19']],
    ['EZEQUIBO', 'Región Ezequibo', ['26']]
  ];

  var ANIOS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */
  var S = {
    iniciado: false,
    modo: 'registro',
    cobertura: 'comuna',
    colores: true,
    cubo: null,
    contexto: { tipo: 'pais', nombre: 'Nivel país', unidad: 'PAIS' },
    capas: { region: null, estado: null, comuna: null },
    capaLimites: null,
    estadosGeo: null,
    renderer: null,
    capaNacional: null,
    capaEstado: null,
    prediosNacional: null,
    promesaNacional: null,
    predios: { codigos: [], features: [] },
    cacheEstados: {},
    promesasEstado: {},
    fondos: { carto: null, satelite: null },
    fondo: 'satelite',
    firmaNac: '',
    firmaEst: '',
    visNacional: { n: 0, ha: 0 },
    visEstado: { n: 0, ha: 0 },
    ultimaVis: { n: 0, ha: 0 },
    popup: null,
    tour: null
  };

  var UI = {};

  var cacheFetch = {};

  /* Diagnóstico de lectura de datos (para saber por qué no carga) */
  var DIAG = { fallos: [], resultado: null, comprobando: false };

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  /** El mapa Leaflet lo crea index.html; puede no existir todavía. */
  function mapa() {
    return (typeof leafletMap !== 'undefined' && leafletMap) ? leafletMap : null;
  }

  function oscuro() {
    return document.documentElement.classList.contains('dark');
  }

  function aviso(msg, tipo) {
    if (typeof showToast === 'function') { showToast(msg, tipo || 'info'); }
  }

  function cargando(mostrar, texto) {
    if (typeof showPrediosLoading === 'function') { showPrediosLoading(mostrar, texto); }
  }

  function num(n) {
    if (n === null || n === undefined || isNaN(n)) { return '—'; }
    return Number(n).toLocaleString('es-VE');
  }

  function dec(n) {
    if (n === null || n === undefined || isNaN(n)) { return '—'; }
    return Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 });
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * El export original del registro trae algunos textos con doble codificación
   * (por ejemplo, la tilde de «EDÉN» aparece como dos caracteres extraños).
   * Se corrigen sólo cuando la conversión es limpia; si no, se devuelve el
   * texto original tal cual.
   */
  function textoBien(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (!s) { return ''; }
    if (!/[ÃÂ]/.test(s)) { return s; }
    try {
      var bytes = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) { bytes[i] = s.charCodeAt(i) & 0xff; }
      var out = new TextDecoder('utf-8').decode(bytes);
      if (out && out.indexOf('\uFFFD') === -1 && out !== s) { return out; }
    } catch (e) { /* sin cambios */ }
    return s;
  }

  function norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function tituloEst(s) {
    var t = textoBien(s).toLowerCase();
    return t.replace(/(^|[\s\-/(])([a-záéíóúüñ])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function codigoDeEstado(nombre) {
    var n = norm(nombre);
    if (!n) { return null; }
    var alias = {
      'VARGAS': 'LA GUAIRA', 'MAIQUETIA': 'LA GUAIRA',
      'GUAYANA ESEQUIBA': 'EZEQUIBO', 'GUAYANA ESEQUIBO': 'EZEQUIBO',
      'ESEQUIBA': 'EZEQUIBO', 'DEPENDENCIAS FEDERALES': 'TERRITORIO INSULAR',
      'ZULIA NORTE': 'ZULIA', 'ZULIA SUR': 'ZULIA'
    };
    if (alias[n]) { n = alias[n]; }
    for (var i = 0; i < ESTADOS.length; i++) {
      if (norm(ESTADOS[i][1]) === n) { return ESTADOS[i][0]; }
    }
    return null;
  }

  function nombreDeCodigo(cod) {
    for (var i = 0; i < ESTADOS.length; i++) {
      if (ESTADOS[i][0] === String(cod)) { return ESTADOS[i][1]; }
    }
    return String(cod);
  }

  function buscarRegion(nombre) {
    var n = norm(nombre);
    for (var i = 0; i < REGIONES.length; i++) {
      if (norm(REGIONES[i][0]) === n || norm(REGIONES[i][1]) === n) { return REGIONES[i]; }
    }
    return null;
  }

  function paleta() {
    return oscuro()
      ? { ini: '#6b5220', fin: '#fde68a', borde: '#8a6a4a', acento: '#fde68a', sinDato: '#14243a' }
      : { ini: '#fff7e6', fin: '#c2410c', borde: '#8a6a4a', acento: '#b45309', sinDato: '#e5e7eb' };
  }

  function mezcla(a, b, t) {
    var pa = parseInt(a.slice(1), 16);
    var pb = parseInt(b.slice(1), 16);
    var ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    var br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function fetchJson(url) {
    if (cacheFetch[url]) { return Promise.resolve(cacheFetch[url]); }
    if (cacheFetch[url + '|p']) { return cacheFetch[url + '|p']; }
    var pr = fetch(url, { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status + ' en ' + url); }
        return r.json();
      })
      .then(function (j) {
        cacheFetch[url] = j;
        delete cacheFetch[url + '|p'];
        return j;
      })
      .catch(function (e) {
        delete cacheFetch[url + '|p'];
        throw e;
      });
    cacheFetch[url + '|p'] = pr;
    return pr;
  }

  /* ------------------------------------------------------------------ */
  /* Diagnóstico de lectura de datos                                     */
  /* ------------------------------------------------------------------ */

  function urlAbs(ruta) {
    try { return new URL(ruta, location.href).href; } catch (e) { return ruta; }
  }

  function esArchivoLocal() {
    return location.protocol === 'file:';
  }

  function nombreCorto(url) {
    try {
      var partes = new URL(url).pathname.split('/').filter(Boolean);
      return decodeURIComponent(partes.slice(-2).join('/'));
    } catch (e) { return String(url); }
  }

  /* Nombres de carpeta que se prueban si la de por omisión no responde. */
  function basesCandidatas() {
    var lista = [];
    try {
      var pedida = new URLSearchParams(location.search).get('geoportal');
      if (pedida) { lista.push(pedida.replace(/\/*$/, '/')); }
    } catch (e) { /* navegador antiguo */ }
    [
      'GEOPORTAL_REGISTRO_SIN_INTERNET/',
      'GEOPORTAL_REGISTRO/',
      'geoportal/',
      'Geoportal/',
      'GEOPORTAL/',
      'registro/'
    ].forEach(function (b) { if (lista.indexOf(b) === -1) { lista.push(b); } });
    return lista;
  }

  /**
   * Descubre dónde están los datos. Permite que la carpeta se llame distinto
   * o que se mueva sin tocar el código; también admite ?geoportal=carpeta/
   */
  function detectarBase() {
    if (esArchivoLocal()) { return Promise.resolve(GEO); }
    var candidatas = basesCandidatas();
    var i = 0;

    function siguiente() {
      if (i >= candidatas.length) { return Promise.resolve(GEO); }
      var base = candidatas[i++];
      return fetch(base + 'datos/cubo.json', { method: 'HEAD', cache: 'no-store' })
        .then(function (r) { return (r.ok || r.status === 405) ? base : siguiente(); })
        .catch(function () { return siguiente(); });
    }

    return siguiente().then(function (base) {
      if (base && base !== GEO) {
        console.info('[reg] carpeta de datos encontrada:', base);
        GEO = base;
        RUTA = crearRutas(base);
      }
      return base;
    });
  }

  function anotarFallo(ruta, error) {
    var url = urlAbs(ruta);
    for (var i = 0; i < DIAG.fallos.length; i++) {
      if (DIAG.fallos[i].url === url) { return; }
    }
    DIAG.fallos.push({ url: url, error: String((error && (error.message || error)) || 'error') });
    pintarAviso();
  }

  function recursosClave() {
    return [
      { nombre: 'Cubo de datos', ruta: RUTA.cubo },
      { nombre: 'Cobertura por región', ruta: RUTA.regiones },
      { nombre: 'Cobertura por estado', ruta: RUTA.estados },
      { nombre: 'Cobertura por comuna', ruta: RUTA.comunas },
      { nombre: 'Registro nacional', ruta: RUTA.pais100 },
      { nombre: 'Predios de un estado', ruta: RUTA.predios('12') },
      { nombre: 'Teselas del mapa base', ruta: GEO + 'vendor/tiles/6/19/30.png' },
      { nombre: 'Leaflet local', ruta: GEO + 'vendor/leaflet.js' }
    ];
  }

  function comprobarRecursos() {
    if (DIAG.comprobando) { return Promise.resolve(DIAG.resultado); }
    DIAG.comprobando = true;
    var trabajos = recursosClave().map(function (r) {
      return fetch(r.ruta, { method: 'HEAD', cache: 'no-store' })
        .then(function (resp) {
          return {
            nombre: r.nombre, url: urlAbs(r.ruta),
            ok: resp.ok || resp.status === 405, status: resp.status
          };
        })
        .catch(function (e) {
          return { nombre: r.nombre, url: urlAbs(r.ruta), ok: false, status: 0, error: e.message };
        });
    });

    return Promise.all(trabajos).then(function (res) {
      DIAG.resultado = res;
      DIAG.comprobando = false;
      res.forEach(function (x) {
        if (!x.ok && !DIAG.fallos.some(function (f) { return f.url === x.url; })) {
          DIAG.fallos.push({ url: x.url, error: x.status ? 'HTTP ' + x.status : (x.error || 'sin respuesta') });
        }
      });
      pintarAviso();
      return res;
    });
  }

  function pintarAviso(forzar) {
    var caja = UI.regAviso;
    if (!caja) { return; }
    var local = esArchivoLocal();

    if (!local && !DIAG.fallos.length && !forzar) { caja.hidden = true; return; }

    var html = '';
    if (local) {
      html += '<b><i class="fa-solid fa-triangle-exclamation"></i> Abierto con doble clic (file://)</b>' +
        '<div>El navegador no permite leer los <code>.geojson</code> desde <code>file://</code>. ' +
        'Abre el visor con un servidor: el hosting (<code>https://inti.gt.tc</code>) o, en tu equipo, ' +
        '<code>node tools/servidor-local.cjs 8123</code> y entra a ' +
        '<code>http://127.0.0.1:8123/index.html</code>.</div>';
    } else if (DIAG.fallos.length) {
      html += '<b><i class="fa-solid fa-triangle-exclamation"></i> No se pudieron leer los datos</b>' +
        '<div>Comprueba que <code>GEOPORTAL_REGISTRO_SIN_INTERNET</code> esté subida junto a ' +
        '<code>index.html</code>, con las carpetas <code>datos/</code> y <code>vendor/</code> dentro.</div>' +
        '<div style="margin-top:4px">Base: <code>' + esc(urlAbs(GEO)) + '</code></div><ul>';
      DIAG.fallos.slice(0, 6).forEach(function (f) {
        html += '<li><code>' + esc(nombreCorto(f.url)) + '</code> · ' + esc(f.error) + '</li>';
      });
      if (DIAG.fallos.length > 6) {
        html += '<li>… y ' + (DIAG.fallos.length - 6) + ' archivo(s) más</li>';
      }
      html += '</ul>';
    } else {
      html += '<b><i class="fa-solid fa-circle-check"></i> Datos accesibles</b>' +
        '<div>Los ' + (DIAG.resultado ? DIAG.resultado.length : 0) +
        ' recursos del geoportal responden correctamente.</div>';
    }

    html += '<div class="reg-aviso-acc">' +
      '<button type="button" class="reg-aviso-btn" id="regAvisoVerificar">Verificar de nuevo</button>' +
      '<button type="button" class="reg-aviso-btn" id="regAvisoRecargar">Recargar</button>' +
      '<span style="flex:1"></span>' +
      '<button type="button" class="reg-aviso-btn" id="regAvisoCerrar">Ocultar</button>' +
      '</div>';

    caja.className = (local || DIAG.fallos.length) ? '' : 'ok';
    caja.innerHTML = html;
    caja.hidden = false;

    document.getElementById('regAvisoVerificar').onclick = function () {
      DIAG.fallos = [];
      comprobarRecursos().then(function () { pintarAviso(true); });
    };
    document.getElementById('regAvisoRecargar').onclick = function () { location.reload(); };
    document.getElementById('regAvisoCerrar').onclick = function () { caja.hidden = true; };
  }

  /* ------------------------------------------------------------------ */
  /* Carga de datos                                                      */
  /* ------------------------------------------------------------------ */

  function cargarCubo() {
    UI.regStatus.textContent = 'Cargando cubo de datos…';
    return fetchJson(RUTA.cubo).then(function (j) {
      S.cubo = j;
      var totalN = 0;
      var totalHa = 0;
      var filas = (j.pais && j.pais.PAIS) || [];
      filas.forEach(function (r) { totalN += r[4] || 0; totalHa += r[5] || 0; });
      S.totales = { n: totalN, ha: totalHa };
      UI.regStatus.textContent = num(totalN) + ' registros · ' + (totalHa / 1e6).toFixed(2).replace('.', ',') + ' M ha';
      var badge = document.getElementById('regBadge');
      if (badge) { badge.innerHTML = '<i class="fa-solid fa-database"></i> ' + num(totalN) + ' registros · ' + (totalHa / 1e6).toFixed(2).replace('.', ',') + ' M ha'; }
      actualizarTablero();
      return j;
    }).catch(function (e) {
      console.error('[reg] cubo', e);
      anotarFallo(RUTA.cubo, e);
      UI.regStatus.textContent = 'Sin cubo de datos: revisa el aviso del panel';
      actualizarTablero();
    });
  }

  function cargarEstados() {
    if (S.estadosGeo) { return Promise.resolve(S.estadosGeo); }
    return fetchJson(RUTA.estados).then(function (j) {
      S.estadosGeo = j;
      return j;
    }).catch(function (e) {
      console.error('[reg] estados', e);
      anotarFallo(RUTA.estados, e);
      return null;
    });
  }

  function cargarEstadoPredios(cod) {
    if (!cod) { return Promise.resolve([]); }
    if (S.cacheEstados[cod]) { return Promise.resolve(S.cacheEstados[cod]); }
    if (S.promesasEstado[cod]) { return S.promesasEstado[cod]; }

    var pr = fetch(RUTA.predios(cod), { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (j) {
        var feats = (j.features || []).map(function (ft) {
          ft.properties._cod = cod;
          return ft;
        });
        S.cacheEstados[cod] = feats;
        return feats;
      })
      .catch(function (e) {
        console.warn('[reg] predios ' + cod, e);
        anotarFallo(RUTA.predios(cod), e);
        return [];
      })
      .then(function (feats) {
        delete S.promesasEstado[cod];
        return feats;
      });

    S.promesasEstado[cod] = pr;
    return pr;
  }

  function cargarNacional() {
    if (S.prediosNacional) { return Promise.resolve(S.prediosNacional); }
    if (S.promesaNacional) { return S.promesaNacional; }

    cargando(true, 'Cargando registro nacional (34.006 predios)…');
    var pr = fetch(RUTA.pais100, { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (j) {
        var feats = (j.features || []).map(function (ft) {
          ft.properties._cod = ft.properties.cod_est;
          return ft;
        });
        S.prediosNacional = feats;
        cargando(false);
        invalidar();
        aplicarFiltros();
        actualizarBotonPredios();
        return feats;
      })
      .catch(function (e) {
        console.warn('[reg] registro nacional', e);
        anotarFallo(RUTA.pais100, e);
        cargando(false);
        aviso('No se pudo cargar el registro nacional (pais_100.geojson)', 'error');
        return [];
      })
      .then(function (feats) {
        S.promesaNacional = null;
        return feats;
      });

    S.promesaNacional = pr;
    return pr;
  }

  /* ------------------------------------------------------------------ */
  /* Capas del mapa                                                      */
  /* ------------------------------------------------------------------ */

  function crearPanes(map) {
    if (!map.getPane('regLimites')) {
      map.createPane('regLimites').style.zIndex = 390;
      map.getPane('regLimites').style.pointerEvents = 'none';
    }
    if (!map.getPane('regPredios')) {
      map.createPane('regPredios').style.zIndex = 450;
    }
  }

  function rendererPredios() {
    if (!S.renderer) {
      S.renderer = L.canvas({ pane: 'regPredios', padding: 0.4 });
      if (S.renderer._container) { S.renderer._container.style.zIndex = '450'; }
    }
    return S.renderer;
  }

  function estiloCobranza(p, max) {
    var pal = paleta();
    if (!S.colores) {
      return { color: pal.borde, weight: 0.8, opacity: 0.9, fillColor: pal.ini, fillOpacity: 0 };
    }
    var v = Number(p.ha_total) || 0;
    var t = Math.max(0, Math.min(1, Math.sqrt(v / (max || 1))));
    var opacidad = S.fondo === 'satelite' ? 0.38 : (oscuro() ? 0.8 : 0.72);
    return {
      color: pal.borde,
      weight: 0.55,
      opacity: 0.85,
      fillColor: mezcla(pal.ini, pal.fin, t),
      fillOpacity: opacidad
    };
  }

  function estiloPredio() {
    var dark = oscuro();
    return {
      color: dark ? '#fde68a' : '#7c2d12',
      weight: 0.45,
      opacity: 0.6,
      fillColor: dark ? '#fbbf24' : '#f59e0b',
      fillOpacity: dark ? 0.5 : 0.45
    };
  }

  function datosCobertura(nivel, p) {
    var etiqueta = nivel === 'region' ? 'Región' : (nivel === 'estado' ? 'Estado' : 'Comuna');
    var nombre = nivel === 'region' ? textoBien(p.region) :
      (nivel === 'estado' ? tituloEst(p.estado) : textoBien(p.comuna));
    var cob = '';
    if (p.pct_cob !== undefined && p.pct_cob !== null) {
      cob = (Number(p.pct_cob) > 100)
        ? 'más de 100 % (los predios se solapan)'
        : dec(p.pct_cob) + ' %';
    }
    return '<div class="reg-tip-title">' + esc(etiqueta) + ': ' + esc(nombre) + '</div>' +
      '<table class="reg-tip-table">' +
      '<tr><td>Superficie registrada</td><td>' + num(p.ha_total) + ' ha</td></tr>' +
      (p.ha_area ? '<tr><td>Superficie de la unidad</td><td>' + num(p.ha_area) + ' ha</td></tr>' : '') +
      (cob ? '<tr><td>Cobertura</td><td>' + esc(cob) + '</td></tr>' : '') +
      (p.n_total !== undefined ? '<tr><td>Registros</td><td>' + num(p.n_total) + '</td></tr>' : '') +
      '</table>' +
      '<div class="reg-tip-hint"><i class="fa-solid fa-hand-pointer"></i> Clic para acercar y cargar sus registros</div>';
  }

  function crearCobertura(nivel, geojson) {
    var max = 0;
    (geojson.features || []).forEach(function (f) {
      max = Math.max(max, Number(f.properties.ha_total) || 0);
    });

    var capa = L.geoJSON(geojson, {
      style: function (f) { return estiloCobranza(f.properties, max); },
      onEachFeature: function (f, layer) {
        layer.bindTooltip(datosCobertura(nivel, f.properties), {
          sticky: true, direction: 'top', opacity: 1, className: 'reg-tip'
        });
        layer.on('mouseover', function () {
          layer.setStyle({ weight: 2, color: paleta().acento });
        });
        layer.on('mouseout', function () {
          capa.resetStyle(layer);
        });
        layer.on('click', function (ev) {
          if (ev && ev.originalEvent) { L.DomEvent.stopPropagation(ev.originalEvent); }
          if (layer.closeTooltip) { layer.closeTooltip(); }
          irAUnidad(nivel, f.properties, layer);
        });
      }
    });
    capa._max = max;
    capa._nivel = nivel;
    capa._data = geojson;
    return capa;
  }

  function crearLimites(geojson) {
    var pal = paleta();
    return L.geoJSON(geojson, {
      pane: 'regLimites',
      interactive: false,
      style: function () {
        return { color: pal.borde, weight: 1.2, opacity: 0.7, fill: false, dashArray: '5 4' };
      }
    });
  }

  function activarCobertura(nivel) {
    S.cobertura = nivel;
    Array.prototype.forEach.call(UI.chips, function (b) {
      b.classList.toggle('on', b.getAttribute('data-nivel') === nivel);
    });

    var map = mapa();
    var capa = S.capas[nivel];
    var pendiente = null;

    if (!capa) {
      UI.regStatus.textContent = 'Cargando cobertura por ' + nivel + '…';
      pendiente = fetchJson(RUTA[ARCHIVO_COBERTURA[nivel]])
        .then(function (gj) {
          S.capas[nivel] = crearCobertura(nivel, gj);
          return S.capas[nivel];
        })
        .catch(function (e) {
          console.error('[reg] cobertura ' + nivel, e);
          anotarFallo(RUTA[ARCHIVO_COBERTURA[nivel]], e);
          aviso('No se pudo cargar la cobertura por ' + nivel, 'error');
          return null;
        });
    } else {
      pendiente = Promise.resolve(capa);
    }

    return pendiente.then(function (c) {
      if (UI.regStatus.textContent.indexOf('Cargando cobertura') === 0) {
        UI.regStatus.textContent = S.totales
          ? num(S.totales.n) + ' registros · ' + (S.totales.ha / 1e6).toFixed(2).replace('.', ',') + ' M ha'
          : 'Geoportal del Registro Agrario';
      }
      if (!map || !c) { actualizarLeyenda(); return; }
      if (S.modo !== 'registro') { actualizarLeyenda(); return; }

      ['region', 'estado', 'comuna'].forEach(function (k) {
        if (k !== nivel && S.capas[k] && map.hasLayer(S.capas[k])) { map.removeLayer(S.capas[k]); }
      });
      if (!map.hasLayer(c)) { c.addTo(map); }
      c.bringToFront();
      actualizarLeyenda();
    });
  }

  function aplicarCoberturaAlMapa() {
    var map = mapa();
    if (!map || S.modo !== 'registro') { return; }
    if (S.capaLimites && !map.hasLayer(S.capaLimites)) { S.capaLimites.addTo(map); }
    var c = S.capas[S.cobertura];
    if (c && !map.hasLayer(c)) { c.addTo(map); }
    if (c) { c.bringToFront(); }
  }

  /* ------------------------------------------------------------------ */
  /* Navegación por el mapa                                              */
  /* ------------------------------------------------------------------ */

  function irAUnidad(nivel, p, layer) {
    if (nivel === 'comuna') {
      var cod = codigoDeEstado(p.estado);
      S.contexto = {
        tipo: 'comuna', nombre: textoBien(p.comuna),
        unidad: String(p.id_comuna), cod: cod
      };
      cargarPredios(cod ? [cod] : [], {
        ajustar: layer,
        mensaje: 'Cargando registros de ' + textoBien(p.comuna) + '…'
      });
      return;
    }

    if (nivel === 'estado') {
      S.contexto = {
        tipo: 'estado', nombre: tituloEst(p.estado),
        unidad: String(p.estado).toUpperCase(), cod: p.cod_est
      };
      cargarPredios([p.cod_est], { ajustar: layer });
      return;
    }

    var reg = buscarRegion(p.region);
    S.contexto = {
      tipo: 'region', nombre: 'Región ' + tituloEst(p.region),
      unidad: String(p.region).toUpperCase()
    };
    cargarPredios(reg ? reg[2] : [], { ajustar: layer });
  }

  function cargarPredios(codigos, opts) {
    opts = opts || {};
    var map = mapa();
    /* El Territorio Insular (25) no tiene polígonos en este conjunto. */
    codigos = (codigos || []).filter(function (c) { return c && c !== '25'; });
    S.predios.codigos = codigos.slice();

    if (!codigos.length) {
      S.predios.features = [];
      refrescar();
      if (opts.ajustar && map) {
        try { map.fitBounds(opts.ajustar.getBounds(), Object.assign({ maxZoom: 11 }, ENCUADRE)); } catch (e) { /* */ }
      }
      return;
    }

    var completo = codigos.every(function (c) { return !!S.cacheEstados[c]; });
    if (!completo) { cargando(true, opts.mensaje || 'Cargando registros del registro agrario…'); }

    Promise.all(codigos.map(cargarEstadoPredios)).then(function (listas) {
      var feats = [];
      listas.forEach(function (l) { feats = feats.concat(l); });
      S.predios.features = feats;
      cargando(false);
      invalidar();
      refrescar();
      if (map && opts.ajustar) {
        try {
          map.fitBounds(opts.ajustar.getBounds(), Object.assign({ maxZoom: 11 }, ENCUADRE));
        } catch (e) { /* */ }
      } else if (map && opts.encuadrar !== false && S.capaEstado && S.modo === 'registro') {
        try {
          map.fitBounds(S.capaEstado.getBounds(), Object.assign({ maxZoom: 9 }, ENCUADRE));
        } catch (e) { /* */ }
      }
      if (!feats.length) { aviso('Sin registros georreferenciados en esta unidad', 'info'); }
      actualizarBotonPredios();
    });
  }

  function irAPais(ajustar) {
    var map = mapa();
    S.contexto = { tipo: 'pais', nombre: 'Nivel país', unidad: 'PAIS' };
    S.predios = { codigos: [], features: [] };
    invalidar();
    refrescar();
    if (map && ajustar !== false) {
      var b = S.capaLimites && S.capaLimites.getBounds && S.capaLimites.getBounds();
      map.fitBounds(b && b.isValid() ? b.pad(0.02) : LIMA, ENCUADRE);
    }
    if (UI.regChkNacional.checked && !S.prediosNacional && !S.promesaNacional) { cargarNacional(); }
  }

  /* ------------------------------------------------------------------ */
  /* Filtros y fichas                                                    */
  /* ------------------------------------------------------------------ */

  function leerFiltros() {
    var tipos = [];
    if (UI.regTipos) {
      Array.prototype.forEach.call(UI.regTipos.querySelectorAll('input:checked'), function (c) {
        tipos.push(c.value);
      });
    }
    var gen = UI.regGenero ? UI.regGenero.querySelector('input:checked') : null;
    var edad = UI.regEdad ? UI.regEdad.querySelector('input:checked') : null;
    return {
      tipos: tipos,
      genero: gen ? gen.value : '',
      edad: edad ? edad.value : '',
      anio: UI.regAnio ? UI.regAnio.value : '',
      soloComunas: UI.regChkComunas ? UI.regChkComunas.checked : false
    };
  }

  function cumpleEdad(edad, grupo) {
    if (!grupo) { return true; }
    if (edad === null || edad === undefined || edad === '') { return false; }
    var e = Number(edad);
    if (grupo === 'joven') { return e >= 18 && e <= 29; }
    if (grupo === 'adulto') { return e >= 30 && e <= 59; }
    if (grupo === 'mayor') { return e >= 60; }
    return true;
  }

  function pasaFiltros(p, f) {
    if (!p) { return false; }
    if (f.tipos.indexOf(p.tipo_de_sujeto) === -1) { return false; }
    if (f.genero && p.sexo !== f.genero) { return false; }
    if (!cumpleEdad(p.edad, f.edad)) { return false; }
    if (f.anio && String(p.anio) !== String(f.anio)) { return false; }
    if (f.soloComunas && !p.comuna) { return false; }
    if (S.contexto.tipo === 'estado' && S.contexto.cod && p._cod && p._cod !== S.contexto.cod) { return false; }
    if (S.contexto.tipo === 'comuna' && p.comuna !== S.contexto.nombre) { return false; }
    return true;
  }

  function conectarFicha(feature, layer) {
    layer.on('click', function (ev) {
      if (ev && ev.originalEvent) { L.DomEvent.stopPropagation(ev.originalEvent); }
      if (layer.closeTooltip) { layer.closeTooltip(); }
      abrirFicha(feature.properties, ev.latlng);
    });
  }

  function fichaHtml(p) {
    var titulo = (p.predio && p.predio !== 'S/N') ? textoBien(p.predio) : 'Predio sin nombre';
    var genero = p.sexo === 'M' ? 'Hombre' : (p.sexo === 'F' ? 'Mujer' : '—');
    return '<div>' +
      '<div class="pp-title">' + esc(titulo) + '</div>' +
      '<div class="pp-sub">ID ' + num(p.id_predio) + ' · ' + dec(p.ha) + ' ha</div>' +
      '<dl>' +
      '<dt>Titular</dt><dd>' + esc(textoBien(p.productor) || '—') + '</dd>' +
      '<dt>Tipo de sujeto</dt><dd>' + esc(p.tipo_de_sujeto || '—') + '</dd>' +
      '<dt>Género</dt><dd>' + genero + '</dd>' +
      '<dt>Edad</dt><dd>' + (p.edad ? esc(p.edad) + ' años' : '—') + '</dd>' +
      '<dt>Año</dt><dd>' + esc(p.anio || '—') + '</dd>' +
      '<dt>Comuna</dt><dd>' + esc(textoBien(p.comuna) || 'Fuera de comuna') + '</dd>' +
      '</dl>' +
      '<div class="pp-note">Fuente: Registro Agrario · geometría simplificada</div>' +
      '</div>';
  }

  function abrirFicha(props, latlng) {
    var map = mapa();
    if (!map) { return; }
    if (!S.popup) {
      S.popup = L.popup({ className: 'reg-popup', maxWidth: 300, autoPan: true });
    }
    S.popup.setLatLng(latlng).setContent(fichaHtml(props)).openOn(map);
  }

  /* ------------------------------------------------------------------ */
  /* Predios                                                             */
  /* ------------------------------------------------------------------ */

  function invalidar() {
    S.firmaNac = '';
    S.firmaEst = '';
  }

  function pintarEstado(f) {
    var map = mapa();
    if (!map) { return; }
    if (S.capaEstado) { map.removeLayer(S.capaEstado); S.capaEstado = null; }
    S.visEstado = { n: 0, ha: 0 };

    if (!UI.regChkEstado.checked || !S.predios.features.length) { return; }

    var vis = S.predios.features.filter(function (ft) { return pasaFiltros(ft.properties, f); });
    S.visEstado = {
      n: vis.length,
      ha: vis.reduce(function (a, ft) { return a + (Number(ft.properties.ha) || 0); }, 0)
    };
    if (!vis.length) { return; }

    S.capaEstado = L.geoJSON({ type: 'FeatureCollection', features: vis }, {
      pane: 'regPredios',
      renderer: rendererPredios(),
      style: estiloPredio,
      onEachFeature: conectarFicha
    });
    if (S.modo === 'registro') { S.capaEstado.addTo(map); }
  }

  function pintarNacional(f) {
    var map = mapa();
    if (!map) { return; }
    if (S.capaNacional) { map.removeLayer(S.capaNacional); S.capaNacional = null; }
    S.visNacional = { n: 0, ha: 0 };

    if (!UI.regChkNacional.checked || !S.prediosNacional) { return; }

    var vis = S.prediosNacional.filter(function (ft) { return pasaFiltros(ft.properties, f); });
    S.visNacional = {
      n: vis.length,
      ha: vis.reduce(function (a, ft) { return a + (Number(ft.properties.ha) || 0); }, 0)
    };
    if (!vis.length) { return; }

    S.capaNacional = L.geoJSON({ type: 'FeatureCollection', features: vis }, {
      pane: 'regPredios',
      renderer: rendererPredios(),
      style: estiloPredio,
      onEachFeature: conectarFicha
    });
    if (S.modo === 'registro') { S.capaNacional.addTo(map); }
  }

  function aplicarFiltros() {
    var map = mapa();
    if (!map) { return; }
    var f = leerFiltros();

    /* Firmas separadas: la nacional no depende del contexto territorial,
       de modo que navegar entre estados no obliga a repintar 34.006 predios. */
    var base = JSON.stringify([f.tipos, f.genero, f.edad, f.anio, f.soloComunas]);
    var fNac = base + '|N|' + (UI.regChkNacional.checked ? 1 : 0) + '|' +
      (S.prediosNacional ? S.prediosNacional.length : 0);
    var fEst = base + '|E|' + (UI.regChkEstado.checked ? 1 : 0) + '|' +
      S.contexto.tipo + '|' + S.contexto.unidad + '|' + S.contexto.nombre + '|' +
      (S.predios.features.length || 0);

    if (fNac === S.firmaNac && fEst === S.firmaEst) {
      actualizarVisibles(S.ultimaVis.n, S.ultimaVis.ha);
      return;
    }
    if (fNac !== S.firmaNac) { S.firmaNac = fNac; pintarNacional(f); }
    if (fEst !== S.firmaEst) { S.firmaEst = fEst; pintarEstado(f); }

    var hayEstado = S.predios.features.length > 0;
    S.ultimaVis = hayEstado
      ? { n: S.visEstado.n, ha: S.visEstado.ha }
      : { n: S.visNacional.n, ha: S.visNacional.ha };
    actualizarVisibles(S.ultimaVis.n, S.ultimaVis.ha);
  }

  function actualizarVisibles(n, ha) {
    if (!UI.regVisibles) { return; }
    UI.regVisibles.innerHTML = 'Polígonos visibles: <b>' + num(n) + '</b> · <b>' +
      num(Math.round(ha)) + '</b> ha';
  }

  function actualizarBotonPredios() {
    var btn = document.getElementById('btnPrediosLayer');
    if (!btn) { return; }
    var on = !!(UI.regChkNacional && UI.regChkNacional.checked);
    btn.setAttribute('data-on', on ? '1' : '0');
    btn.title = on
      ? 'Ocultar los predios del registro nacional (100 ha o más)'
      : 'Mostrar los predios del registro nacional (100 ha o más)';
    var count = document.getElementById('prediosBtnCount');
    if (count) {
      count.textContent = S.prediosNacional
        ? num(S.prediosNacional.length)
        : (S.totales && S.totales.n ? num(S.totales.n) : '440.790');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tablero                                                             */
  /* ------------------------------------------------------------------ */

  function statsCubo(nivelKey, unidad) {
    var f = leerFiltros();
    var s = {
      n_total: 0, ha_total: 0, n_hombres: 0, n_mujeres: 0,
      n_jovenes: 0, n_adultos: 0, n_mayores: 0,
      n_natural: 0, n_red: 0, n_juridico: 0
    };
    if (!S.cubo) { return s; }
    var grupo = (S.cubo[nivelKey] || {})[unidad] || [];
    grupo.forEach(function (r) {
      if (f.anio && r[0] !== Number(f.anio)) { return; }
      if (f.tipos.indexOf(TIPOS[r[1]]) === -1) { return; }
      if (f.genero && ['M', 'F'][r[2]] !== f.genero) { return; }
      if (f.edad && ['joven', 'adulto', 'mayor', 'sin'][r[3]] !== f.edad) { return; }
      var n = r[4];
      var ha = r[5];
      s.n_total += n;
      s.ha_total += ha;
      if (r[1] === 0) { s.n_natural += n; }
      if (r[1] === 1) { s.n_red += n; }
      if (r[1] === 2) { s.n_juridico += n; }
      if (r[2] === 0) { s.n_hombres += n; }
      if (r[2] === 1) { s.n_mujeres += n; }
      if (r[3] === 0) { s.n_jovenes += n; }
      if (r[3] === 1) { s.n_adultos += n; }
      if (r[3] === 2) { s.n_mayores += n; }
    });
    return s;
  }

  function statsPredios(feats) {
    var s = {
      n_total: 0, ha_total: 0, n_hombres: 0, n_mujeres: 0,
      n_jovenes: 0, n_adultos: 0, n_mayores: 0,
      n_natural: 0, n_red: 0, n_juridico: 0
    };
    feats.forEach(function (ft) {
      var p = ft.properties;
      s.n_total++;
      s.ha_total += Number(p.ha) || 0;
      if (p.sexo === 'M') { s.n_hombres++; }
      if (p.sexo === 'F') { s.n_mujeres++; }
      if (p.edad >= 18 && p.edad <= 29) { s.n_jovenes++; }
      if (p.edad >= 30 && p.edad <= 59) { s.n_adultos++; }
      if (p.edad >= 60) { s.n_mayores++; }
      if (p.tipo_de_sujeto === 'Natural') { s.n_natural++; }
      if (p.tipo_de_sujeto === 'Red') { s.n_red++; }
      if (p.tipo_de_sujeto === 'Jurídico') { s.n_juridico++; }
    });
    return s;
  }

  function pintarBarras(id, filas) {
    var cont = document.getElementById(id);
    if (!cont) { return; }
    var max = Math.max.apply(null, filas.map(function (f) { return f[1] || 0; }).concat([1]));
    cont.innerHTML = filas.map(function (f) {
      var w = 100 * (f[1] || 0) / max;
      return '<div class="reg-bar"><span>' + esc(f[0]) + '</span>' +
        '<span class="reg-bar-track"><span class="reg-bar-fill" style="width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="reg-bar-n">' + num(f[1]) + '</span></div>';
    }).join('');
  }

  function actualizarTablero() {
    if (!UI.regDashTitulo) { return; }
    var s;
    var titulo;

    if (S.contexto.tipo === 'comuna') {
      s = statsCubo('comuna', S.contexto.unidad);
      if (!s.n_total && S.predios.features.length) {
        var enComuna = S.predios.features.filter(function (ft) {
          return ft.properties.comuna === S.contexto.nombre;
        });
        if (enComuna.length) { s = statsPredios(enComuna); }
      }
      titulo = 'Comuna: ' + S.contexto.nombre;
    } else if (S.contexto.tipo === 'region') {
      s = statsCubo('region', S.contexto.unidad);
      titulo = S.contexto.nombre;
    } else if (S.contexto.tipo === 'estado') {
      s = statsCubo('estado', S.contexto.unidad);
      titulo = 'Estado: ' + S.contexto.nombre;
    } else {
      s = statsCubo('pais', 'PAIS');
      titulo = 'Nivel país';
    }

    UI.regDashTitulo.textContent = titulo;
    UI.regDashTitulo.title = titulo;

    if (UI.regKpis) {
      UI.regKpis.innerHTML =
        '<div class="reg-kpi"><b>' + num(s.n_total) + '</b><span>Registros</span></div>' +
        '<div class="reg-kpi"><b>' + num(Math.round(s.ha_total)) + '</b><span>Superficie (ha)</span></div>' +
        '<div class="reg-kpi"><b>' + num(s.n_hombres) + '</b><span>Hombres</span></div>' +
        '<div class="reg-kpi"><b>' + num(s.n_mujeres) + '</b><span>Mujeres</span></div>';
    }

    pintarBarras('regBarGenero', [['Hombres', s.n_hombres], ['Mujeres', s.n_mujeres]]);
    pintarBarras('regBarEdad', [['Jóvenes', s.n_jovenes], ['Adultos', s.n_adultos], ['Mayores', s.n_mayores]]);
    pintarBarras('regBarTipo', [['Naturales', s.n_natural], ['Redes', s.n_red], ['Jurídicos', s.n_juridico]]);
  }

  function actualizarLeyenda() {
    if (!UI.regLeyendaTitulo) { return; }
    var capa = S.capas[S.cobertura];
    var nombres = { region: 'región', estado: 'estado', comuna: 'comuna' };
    UI.regLeyendaTitulo.textContent = 'Superficie registrada por ' + nombres[S.cobertura];
    var pal = paleta();
    if (UI.regLeyendaBar) {
      UI.regLeyendaBar.style.background = S.colores
        ? 'linear-gradient(90deg,' + pal.ini + ',' + pal.fin + ')'
        : 'transparent';
      UI.regLeyendaBar.style.border = S.colores ? '0' : '1px dashed #94a3b8';
    }
    if (UI.regLeyendaMin) { UI.regLeyendaMin.textContent = S.colores ? '0 ha' : 'sólo bordes'; }
    if (UI.regLeyendaMax) {
      UI.regLeyendaMax.textContent = S.colores && capa && capa._max
        ? num(Math.round(capa._max)) + ' ha'
        : '—';
    }
  }

  function refrescar() {
    actualizarTablero();
    aplicarFiltros();
  }

  /* ------------------------------------------------------------------ */
  /* Modos de visualización                                              */
  /* ------------------------------------------------------------------ */

  function setModo(modo, silencioso) {
    var nuevo = modo === 'ort' ? 'ort' : 'registro';
    S.modo = nuevo;
    var reg = nuevo === 'registro';

    if (UI.regPanel) { UI.regPanel.hidden = !reg; }
    if (UI.regDash) { UI.regDash.hidden = !reg; }
    if (UI.ortConsolidador) { UI.ortConsolidador.classList.toggle('hidden', reg); }
    if (UI.regBadge) { UI.regBadge.classList.toggle('hidden', !reg); }
    if (UI.ortMetric) { UI.ortMetric.classList.toggle('hidden', reg); }
    if (UI.hint) { UI.hint.classList.toggle('hidden', reg); }
    if (UI.overlaysOrt) { UI.overlaysOrt.classList.toggle('hidden', reg); }

    var map = mapa();
    var geo = (typeof mapGeoLayer !== 'undefined') ? mapGeoLayer : null;
    var labels = (typeof mapLabelsLayer !== 'undefined') ? mapLabelsLayer : null;

    if (map) {
      if (reg) {
        if (geo && map.hasLayer(geo)) { map.removeLayer(geo); }
        if (labels && map.hasLayer(labels)) { map.removeLayer(labels); }
        aplicarCoberturaAlMapa();
        ['capaNacional', 'capaEstado'].forEach(function (k) {
          var c = S[k];
          if (c && !map.hasLayer(c)) { c.addTo(map); }
        });
        aplicarFondo(S.fondo, true);
      } else {
        [S.capas.region, S.capas.estado, S.capas.comuna, S.capaLimites,
          S.capaNacional, S.capaEstado, S.fondos.carto, S.fondos.satelite].forEach(function (c) {
          if (c && map.hasLayer(c)) { map.removeLayer(c); }
        });
        if (geo && !map.hasLayer(geo)) { geo.addTo(map); }
        if (labels && !map.hasLayer(labels)) { labels.addTo(map); }
        if (typeof updateMapLabels === 'function') { updateMapLabels(); }
        if (typeof updateMapLegend === 'function') { updateMapLegend(); }
      }
    }

    sincronizarBotonesModo();
    ajustarLimitesMapa(reg);

    if (!silencioso && map) {
      if (reg) {
        var b = S.capaLimites && S.capaLimites.getBounds && S.capaLimites.getBounds();
        map.fitBounds(b && b.isValid() ? b.pad(0.02) : LIMA, ENCUADRE);
        aviso('Modo Registro Agrario: coberturas, predios y tablero del geoportal', 'info');
      } else {
        if (geo) { map.fitBounds(geo.getBounds().pad(0.02)); }
        aviso('Modo ORT 2026: coropleta de títulos y superficie regularizada', 'info');
      }
    }
  }

  function sincronizarBotonesModo() {
    var a = document.getElementById('btnModoRegistro');
    var b = document.getElementById('btnModoOrt');
    if (a) { a.classList.toggle('on', S.modo === 'registro'); }
    if (b) { b.classList.toggle('on', S.modo === 'ort'); }
  }

  /* El visor original limita el encuadre a los límites del país. En modo
     registro se libera para poder correr el mapa a la derecha y dejar el
     territorio fuera del panel de filtros; en modo ORT se restituye. */
  function ajustarLimitesMapa(modoRegistro) {
    var map = mapa();
    if (!map || typeof map.setMaxBounds !== 'function') { return; }
    if (modoRegistro) {
      map.setMaxBounds(null);
    } else {
      map.setMaxBounds(L.latLngBounds([[-1.5, -78], [15.5, -54]]));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Fondos del mapa: satélite, cartográfico local y fondo INTi          */
  /* ------------------------------------------------------------------ */

  var SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var SATELITE_ETIQUETAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  var FONDOS = {
    satelite: {
      titulo: 'Satélite',
      atribucion: 'Imágenes: Esri, Maxar, Earthstar Geographics · Etiquetas: Esri',
      nota: 'Imágenes satelitales de Esri (necesita internet) con nombres de referencia.'
    },
    carto: {
      titulo: 'Cartográfico',
      atribucion: '© OpenStreetMap · teselas locales del geoportal (zoom 6-9)',
      nota: 'Teselas de OpenStreetMap incluidas en el geoportal (zoom 6 a 9).'
    },
    inti: {
      titulo: 'INTi',
      atribucion: 'Fondo institucional INTi · FAO',
      nota: 'Fondo original del visor, sin imágenes externas.'
    }
  };

  function crearFondos() {
    /* Las teselas locales existen de zoom 6 a 9: minNativeZoom permite
       mostrarlas también en las vistas más alejadas (se escalan). */
    var comun = {
      minNativeZoom: 6,
      maxNativeZoom: 9,
      maxZoom: 19,
      bounds: [[0.6, -74.0], [12.3, -57.7]],
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      className: 'reg-tiles'
    };

    S.fondos.carto = L.tileLayer(RUTA.tiles, comun);

    var satelite = L.tileLayer(SATELITE, {
      maxZoom: 19,
      maxNativeZoom: 18,
      className: 'reg-satelite',
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    });
    var etiquetas = L.tileLayer(SATELITE_ETIQUETAS, {
      maxZoom: 19,
      maxNativeZoom: 18,
      className: 'reg-etiquetas',
      opacity: 0.95,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    });
    S.fondos.satelite = L.layerGroup([satelite, etiquetas]);
  }

  function fijarAtribucion(texto) {
    var map = mapa();
    var ctrl = map && map.attributionControl;
    if (!ctrl) { return; }
    if (ctrl._regFondo) { ctrl.removeAttribution(ctrl._regFondo); }
    ctrl._regFondo = texto;
    if (texto) { ctrl.addAttribution(texto); }
  }

  function actualizarChipsFondo() {
    Array.prototype.forEach.call(UI.chipsFondo || [], function (b) {
      b.classList.toggle('on', b.getAttribute('data-fondo') === S.fondo);
    });
    var nota = document.getElementById('regFondoNota');
    if (nota && FONDOS[S.fondo]) { nota.textContent = FONDOS[S.fondo].nota; }
  }

  function restyleCapas() {
    ['region', 'estado', 'comuna'].forEach(function (k) {
      var c = S.capas[k];
      if (c) { c.setStyle(function (f) { return estiloCobranza(f.properties, c._max); }); }
    });
    actualizarLeyenda();
  }

  function aplicarFondo(nombre, silencioso) {
    var map = mapa();
    var nuevo = FONDOS[nombre] ? nombre : 'inti';
    S.fondo = nuevo;

    if (map) {
      ['carto', 'satelite'].forEach(function (k) {
        var capa = S.fondos[k];
        if (capa && map.hasLayer(capa)) { map.removeLayer(capa); }
      });

      if (S.modo === 'registro' && nuevo !== 'inti' && S.fondos[nuevo]) {
        S.fondos[nuevo].addTo(map);
        if (typeof S.fondos[nuevo].bringToBack === 'function') { S.fondos[nuevo].bringToBack(); }
        var pane = map.getPane('tilePane');
        if (pane && S.fondos[nuevo].bringToBack) { S.fondos[nuevo].bringToBack(); }
      }
    }

    actualizarChipsFondo();
    fijarAtribucion(FONDOS[nuevo].atribucion);
    restyleCapas();

    if (!silencioso) {
      aviso('Fondo del mapa: ' + FONDOS[nuevo].titulo +
        (nuevo === 'satelite' ? ' (imágenes de Esri; requiere internet)' : ''), 'info');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Cableado de la interfaz                                             */
  /* ------------------------------------------------------------------ */

  function cachearUI() {
    UI.regPanel = document.getElementById('regPanel');
    UI.regDash = document.getElementById('regDash');
    UI.regStatus = document.getElementById('regStatus');
    UI.regPanelBody = document.getElementById('regPanelBody');
    UI.regPanelToggle = document.getElementById('regPanelToggle');
    UI.regTourBtn = document.getElementById('regTourBtn');
    UI.regDiagBtn = document.getElementById('regDiagBtn');
    UI.regAviso = document.getElementById('regAviso');
    UI.regColorBtn = document.getElementById('regColorBtn');
    UI.chipCont = document.getElementById('regCoberturaChips');
    UI.chips = UI.chipCont ? UI.chipCont.querySelectorAll('button[data-nivel]') : [];
    UI.chipsFondoCont = document.getElementById('regFondoChips');
    UI.chipsFondo = UI.chipsFondoCont ? UI.chipsFondoCont.querySelectorAll('button[data-fondo]') : [];
    UI.regChkNacional = document.getElementById('regChkNacional');
    UI.regChkEstado = document.getElementById('regChkEstado');
    UI.regChkComunas = document.getElementById('regChkComunas');
    UI.regTipos = document.getElementById('regTipos');
    UI.regGenero = document.getElementById('regGenero');
    UI.regEdad = document.getElementById('regEdad');
    UI.regAnio = document.getElementById('regAnio');
    UI.regDashToggle = document.getElementById('regDashToggle');
    UI.regDashTitulo = document.getElementById('regDashTitulo');
    UI.regKpis = document.getElementById('regKpis');
    UI.regBtnPais = document.getElementById('regBtnPais');
    UI.regBtnLimpiar = document.getElementById('regBtnLimpiar');
    UI.regVisibles = document.getElementById('regVisibles');
    UI.regLeyendaTitulo = document.getElementById('regLeyendaTitulo');
    UI.regLeyendaBar = document.getElementById('regLeyendaBar');
    UI.regLeyendaMin = document.getElementById('regLeyendaMin');
    UI.regLeyendaMax = document.getElementById('regLeyendaMax');
    UI.regBadge = document.getElementById('regBadge');
    UI.ortMetric = document.getElementById('ortMetricSwitch');
    UI.ortConsolidador = document.getElementById('ortConsolidador');
    UI.hint = document.getElementById('mapHintChip');
    UI.overlaysOrt = document.getElementById('mapOverlaysOrt');
  }

  function rellenarAnios() {
    if (!UI.regAnio) { return; }
    var html = '<option value="">Todos los años</option>';
    ANIOS.forEach(function (a) { html += '<option value="' + a + '">' + a + '</option>'; });
    UI.regAnio.innerHTML = html;
  }

  function conectarEventos() {
    if (UI.chipCont) {
      UI.chipCont.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-nivel]') : null;
        if (!b) { return; }
        activarCobertura(b.getAttribute('data-nivel'));
      });
    }

    if (UI.chipsFondoCont) {
      UI.chipsFondoCont.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-fondo]') : null;
        if (!b) { return; }
        aplicarFondo(b.getAttribute('data-fondo'));
      });
    }

    if (UI.regColorBtn) {
      UI.regColorBtn.addEventListener('click', function () {
        S.colores = !S.colores;
        UI.regColorBtn.textContent = S.colores ? 'Quitar colores' : 'Poner colores';
        ['region', 'estado', 'comuna'].forEach(function (k) {
          var c = S.capas[k];
          if (c) { c.setStyle(function (f) { return estiloCobranza(f.properties, c._max); }); }
        });
        actualizarLeyenda();
      });
    }

    if (UI.regPanelToggle) {
      UI.regPanelToggle.addEventListener('click', function () {
        var p = UI.regPanel;
        var col = p.classList.toggle('collapsed');
        this.innerHTML = col ? '<i class="fa-solid fa-chevron-right"></i>' : '<i class="fa-solid fa-chevron-left"></i>';
        var m = mapa();
        if (m) { setTimeout(function () { m.invalidateSize(); }, 200); }
      });
    }

    if (UI.regDashToggle) {
      UI.regDashToggle.addEventListener('click', function () {
        var col = UI.regDash.classList.toggle('collapsed');
        this.innerHTML = col ? '<i class="fa-solid fa-chevron-left"></i>' : '<i class="fa-solid fa-chevron-right"></i>';
      });
    }

    if (UI.regChkNacional) {
      UI.regChkNacional.addEventListener('change', function () {
        var on = UI.regChkNacional.checked;
        invalidar();
        if (on && !S.prediosNacional && !S.promesaNacional) {
          cargarNacional();
        } else {
          aplicarFiltros();
        }
        actualizarBotonPredios();
        aviso(on ? 'Predios del registro nacional activados' : 'Predios del registro nacional ocultos', 'info');
      });
    }

    if (UI.regChkEstado) {
      UI.regChkEstado.addEventListener('change', function () {
        invalidar();
        aplicarFiltros();
        aviso(UI.regChkEstado.checked
          ? 'Predios del estado o región activados'
          : 'Predios del estado o región ocultos', 'info');
      });
    }

    if (UI.regChkComunas) {
      UI.regChkComunas.addEventListener('change', function () { invalidar(); refrescar(); });
    }

    [UI.regTipos, UI.regGenero, UI.regEdad].forEach(function (cont) {
      if (!cont) { return; }
      cont.addEventListener('change', function () { invalidar(); refrescar(); });
    });

    if (UI.regAnio) {
      UI.regAnio.addEventListener('change', function () { invalidar(); refrescar(); });
    }

    if (UI.regBtnPais) {
      UI.regBtnPais.addEventListener('click', function () { irAPais(true); });
    }

    if (UI.regBtnLimpiar) {
      UI.regBtnLimpiar.addEventListener('click', limpiarFiltros);
    }

    if (UI.regTourBtn) {
      UI.regTourBtn.addEventListener('click', function () { iniciarTour(); });
    }

    if (UI.regDiagBtn) {
      UI.regDiagBtn.addEventListener('click', function () {
        DIAG.fallos = [];
        pintarAviso(true);
        comprobarRecursos().then(function () { pintarAviso(true); });
      });
    }

    var btnModoReg = document.getElementById('btnModoRegistro');
    var btnModoOrt = document.getElementById('btnModoOrt');
    if (btnModoReg) { btnModoReg.addEventListener('click', function () { setModo('registro'); }); }
    if (btnModoOrt) { btnModoOrt.addEventListener('click', function () { setModo('ort'); }); }
  }

  function limpiarFiltros() {
    if (UI.regTipos) {
      Array.prototype.forEach.call(UI.regTipos.querySelectorAll('input'), function (c) { c.checked = true; });
    }
    [UI.regGenero, UI.regEdad].forEach(function (cont) {
      if (!cont) { return; }
      Array.prototype.forEach.call(cont.querySelectorAll('input'), function (c) {
        c.checked = c.value === '';
      });
    });
    if (UI.regAnio) { UI.regAnio.value = ''; }
    if (UI.regChkComunas) { UI.regChkComunas.checked = false; }
    invalidar();
    refrescar();
    aviso('Filtros restablecidos', 'success');
  }

  function alternarNacional() {
    if (!S.iniciado) { return; }
    if (S.modo !== 'registro') { setModo('registro', true); }
    if (!UI.regChkNacional) { return; }
    UI.regChkNacional.checked = !UI.regChkNacional.checked;
    var on = UI.regChkNacional.checked;
    invalidar();
    if (on && !S.prediosNacional && !S.promesaNacional) { cargarNacional(); }
    else { aplicarFiltros(); }
    actualizarBotonPredios();
    aviso(on ? 'Mostrando los predios del registro nacional' : 'Predios nacionales ocultos', 'info');
  }

  /* ------------------------------------------------------------------ */
  /* Recorrido guiado                                                    */
  /* ------------------------------------------------------------------ */

  var PASOS_TOUR = [
    {
      t: 'Registro Agrario en el visor',
      x: 'El visor ahora reúne el geoportal del Registro Agrario: coberturas de superficie, polígonos de predios y un tablero que responde a los filtros. Recorrido de un minuto.',
      sel: null
    },
    {
      t: 'Cobertura por unidad',
      x: 'Pinte la superficie registrada por región, por estado o por comuna. Se enciende una sola a la vez para no confundir el clic.',
      sel: '#regCoberturaChips'
    },
    {
      t: 'Quitar colores',
      x: 'Deja las coberturas sólo con borde. Útil para ver el fondo y los polígonos de predios con más claridad.',
      sel: '#regColorBtn'
    },
    {
      t: 'Registro nacional',
      x: 'Muestra los predios de 100 hectáreas o más de todo el país: 34.006 polígonos que se cargan desde los datos locales.',
      sel: '#regChkNacional'
    },
    {
      t: 'Registros del estado o región',
      x: 'Al tocar una comuna, un estado o una región en el mapa se cargan sus polígonos de registro con su ficha.',
      sel: '#regChkEstado'
    },
    {
      t: 'Solo los que están en comunas',
      x: 'Deja únicamente los registros que caen dentro de una comuna, para separar el registro comunalizado.',
      sel: '#regChkComunas'
    },
    {
      t: 'Tipo de sujeto',
      x: 'Filtra personas naturales, redes y sujetos jurídicos. El tablero y los polígonos se actualizan al instante.',
      sel: '#regTipos'
    },
    {
      t: 'Género y edad del titular',
      x: 'Combina género y grupo de edad con el resto de los filtros. Los totales del tablero se recalculan con el cubo.',
      sel: '#regGenero'
    },
    {
      t: 'Año del registro',
      x: 'Limita los registros a un año entre 2014 y 2026.',
      sel: '#regAnio'
    },
    {
      t: 'Tablero',
      x: 'Muestra registros, superficie, hombres y mujeres de la unidad activa, con barras por género, edad y tipo de sujeto. «País» vuelve al inicio y «Limpiar» restablece los filtros.',
      sel: '#regDash'
    },
    {
      t: 'Fondo del mapa',
      x: 'Cambia entre imagen satelital (Esri), el mapa cartográfico del geoportal con sus teselas locales y el fondo institucional original. El satélite pide internet; las teselas y el fondo INTi funcionan sin conexión.',
      sel: '#regFondoChips'
    },
    {
      t: 'Listo',
      x: 'Toque cualquier polígono para abrir su ficha, cambie de capa y use los filtros. Vuelva a ORT 2026 con el selector del encabezado cuando quiera la vista institucional.',
      sel: null
    }
  ];

  function construirTour() {
    if (S.tour && S.tour.card) { return S.tour; }

    var overlay = document.createElement('div');
    overlay.id = 'regTourOverlay';

    var card = document.createElement('div');
    card.id = 'regTourCard';
    card.innerHTML =
      '<p class="reg-tour-step" id="regTourStep">Paso</p>' +
      '<h4 id="regTourTitulo"></h4>' +
      '<p id="regTourTexto"></p>' +
      '<div class="reg-tour-foot">' +
      '<span style="flex:1"></span>' +
      '<button type="button" class="reg-tour-btn" id="regTourPlay">▶ Reproducir</button>' +
      '<button type="button" class="reg-tour-btn" id="regTourPrev">Anterior</button>' +
      '<button type="button" class="reg-tour-btn primary" id="regTourNext">Siguiente</button>' +
      '<button type="button" class="reg-tour-btn" id="regTourClose" title="Cerrar">✕</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(card);

    var T = {
      overlay: overlay,
      card: card,
      i: 0,
      timer: null,
      foco: null,
      step: card.querySelector('#regTourStep'),
      titulo: card.querySelector('#regTourTitulo'),
      texto: card.querySelector('#regTourTexto'),
      play: card.querySelector('#regTourPlay'),
      prev: card.querySelector('#regTourPrev'),
      next: card.querySelector('#regTourNext')
    };

    T.play.addEventListener('click', function () {
      if (T.timer) { detenerTour(T); } else { reproducirTour(T); }
    });
    T.prev.addEventListener('click', function () {
      if (T.i > 0) { T.i--; pintarTour(T); }
    });
    T.next.addEventListener('click', function () {
      if (T.i < PASOS_TOUR.length - 1) { T.i++; pintarTour(T); } else { cerrarTour(); }
    });
    card.querySelector('#regTourClose').addEventListener('click', cerrarTour);
    overlay.addEventListener('click', function (e) { e.stopPropagation(); });

    S.tour = T;
    return T;
  }

  function limpiarFocoTour(T) {
    if (T.foco) {
      T.foco.classList.remove('reg-tour-focus');
      T.foco = null;
    }
  }

  function reproducirTour(T) {
    T.play.textContent = '❚❚ Pausar';
    T.timer = setInterval(function () {
      if (T.i < PASOS_TOUR.length - 1) { T.i++; pintarTour(T); } else { detenerTour(T); }
    }, 6500);
  }

  function detenerTour(T) {
    if (T.timer) { clearInterval(T.timer); T.timer = null; }
    if (T.play) { T.play.textContent = '▶ Reproducir'; }
  }

  function pintarTour(T) {
    var p = PASOS_TOUR[T.i];
    T.play.textContent = T.timer ? '❚❚ Pausar' : '▶ Reproducir';
    T.step.textContent = 'Paso ' + (T.i + 1) + ' de ' + PASOS_TOUR.length;
    T.titulo.textContent = p.t;
    T.texto.textContent = p.x;
    T.prev.disabled = T.i === 0;
    T.next.textContent = (T.i === PASOS_TOUR.length - 1) ? 'Terminar' : 'Siguiente';

    limpiarFocoTour(T);

    var ancho = 340;
    var left = Math.max(12, (window.innerWidth - ancho) / 2);
    var top = Math.max(12, (window.innerHeight - 190) / 2);

    if (p.sel) {
      var el = document.querySelector(p.sel);
      if (el) {
        if (UI.regPanel && UI.regPanel.classList.contains('collapsed') && UI.regPanel.contains(el)) {
          UI.regPanel.classList.remove('collapsed');
        }
        el.classList.add('reg-tour-focus');
        T.foco = el;
        var r = el.getBoundingClientRect();
        left = r.right + 14;
        if (left + ancho > window.innerWidth - 10) { left = Math.max(10, r.left - ancho - 14); }
        top = Math.min(Math.max(10, r.top - 10), window.innerHeight - 220);
      }
    }

    T.card.style.left = left + 'px';
    T.card.style.top = top + 'px';
  }

  function iniciarTour() {
    var T = construirTour();
    T.i = 0;
    T.overlay.style.display = 'block';
    T.card.style.display = 'block';
    if (UI.regPanel && UI.regPanel.hidden) { setModo('registro', true); }
    pintarTour(T);
  }

  function cerrarTour() {
    if (!S.tour) { return; }
    detenerTour(S.tour);
    limpiarFocoTour(S.tour);
    S.tour.overlay.style.display = 'none';
    S.tour.card.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* Tema                                                                */
  /* ------------------------------------------------------------------ */

  function observarTema() {
    if (typeof MutationObserver === 'undefined') { return; }
    var pendiente = false;
    var obs = new MutationObserver(function () {
      if (pendiente) { return; }
      pendiente = true;
      window.requestAnimationFrame(function () {
        pendiente = false;
        refrescarTema();
      });
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  function refrescarTema() {
    ['region', 'estado', 'comuna'].forEach(function (k) {
      var c = S.capas[k];
      if (c) { c.setStyle(function (f) { return estiloCobranza(f.properties, c._max); }); }
    });
    if (S.capaLimites) {
      var pal = paleta();
      S.capaLimites.setStyle(function () {
        return { color: pal.borde, weight: 1.2, opacity: 0.7, fill: false, dashArray: '5 4' };
      });
    }
    if (S.capaNacional) { S.capaNacional.setStyle(estiloPredio); }
    if (S.capaEstado) { S.capaEstado.setStyle(estiloPredio); }
    actualizarLeyenda();
  }

  /* ------------------------------------------------------------------ */
  /* Integración con el visor existente                                  */
  /* ------------------------------------------------------------------ */

  function envolver(nombre, despues) {
    var orig = window[nombre];
    if (typeof orig !== 'function' || orig.__regEnvuelto) { return; }
    var envuelto = function () {
      var r = orig.apply(this, arguments);
      try { despues.apply(this, arguments); } catch (e) { console.error('[reg] ' + nombre, e); }
      return r;
    };
    envuelto.__regEnvuelto = true;
    window[nombre] = envuelto;
  }

  function parchearGlobales() {
    // Al abrir la pestaña del visor, index.html crea el mapa: enganchamos ahí.
    envolver('initVenezuelaMap', function () {
      if (!S.iniciado && mapa()) { iniciar(); }
    });

    // «Ver predios en el mapa» de las fichas de estado ahora usa el registro real.
    window.verPrediosEnMapa = function (nombre) {
      if (typeof closeInteractiveModal === 'function') { closeInteractiveModal(); }
      var cod = codigoDeEstado(nombre);
      if (S.modo !== 'registro') { setModo('registro', true); }
      if (!cod) { aviso('Sin registros georreferenciados para ' + nombre, 'info'); return; }
      if (cod === '25') { aviso('Territorio Insular: sin polígonos en este conjunto', 'info'); return; }
      if (UI.regChkEstado) { UI.regChkEstado.checked = true; }
      S.contexto = {
        tipo: 'estado',
        nombre: nombreDeCodigo(cod),
        unidad: nombreDeCodigo(cod).toUpperCase(),
        cod: cod
      };
      invalidar();
      cargarPredios([cod], {});
      aviso('Cargando predios de ' + nombreDeCodigo(cod) + '…', 'info');
    };

    // Clic en la lista lateral de entidades: además de la ficha, carga sus predios.
    envolver('focusMapState', function (nombre) {
      if (S.modo === 'registro' && S.iniciado) {
        var cod = codigoDeEstado(nombre);
        if (cod && cod !== '25') {
          S.contexto = {
            tipo: 'estado', nombre: nombreDeCodigo(cod),
            unidad: nombreDeCodigo(cod).toUpperCase(), cod: cod
          };
          if (UI.regChkEstado) { UI.regChkEstado.checked = true; }
          invalidar();
          cargarPredios([cod], {});
        }
      }
    });

    // Vista nacional: en modo registro vuelve al país del geoportal.
    var resetOriginal = window.resetMapView;
    window.resetMapView = function () {
      if (S.modo === 'registro' && S.iniciado) {
        irAPais(true);
        aviso('Vista nacional del Registro Agrario restablecida', 'info');
        return;
      }
      if (typeof resetOriginal === 'function') { resetOriginal.apply(this, arguments); }
    };

    // Esequibo: en modo registro encuadra el polígono del geoportal.
    var esequiboOriginal = window.focusEsequibo;
    window.focusEsequibo = function () {
      if (S.modo === 'registro' && S.iniciado && S.estadosGeo) {
        var capa = S.capas.estado;
        var encuadre = null;
        if (capa) {
          capa.eachLayer(function (l) {
            if (l.feature && String(l.feature.properties.cod_est) === '26') { encuadre = l.getBounds(); }
          });
        }
        var map = mapa();
        if (encuadre && map) {
          map.fitBounds(encuadre.pad(0.12));
          aviso('Estado Guayana Esequiba — Zona en Reclamación (Acuerdo de Ginebra, 1966)', 'info');
          return;
        }
      }
      if (typeof esequiboOriginal === 'function') { esequiboOriginal.apply(this, arguments); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                            */
  /* ------------------------------------------------------------------ */

  function iniciar() {
    if (S.iniciado) {
      var m0 = mapa();
      if (m0) { setTimeout(function () { m0.invalidateSize(); }, 60); }
      return;
    }
    var map = mapa();
    if (!map || typeof L === 'undefined') { return; }

    cachearUI();
    if (!UI.regPanel) {
      console.warn('[reg] Falta el marcado del panel de Registro Agrario en index.html');
      return;
    }

    S.iniciado = true;
    crearPanes(map);
    rellenarAnios();
    conectarEventos();
    observarTema();

    setModo('registro', true);
    map.fitBounds(LIMA, ENCUADRE);

    // Panel plegado en pantallas estrechas
    if (window.innerWidth < 720 && UI.regPanel && UI.regPanelToggle) {
      UI.regPanel.classList.add('collapsed');
      UI.regPanelToggle.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      if (UI.regDash) {
        UI.regDash.classList.add('collapsed');
        if (UI.regDashToggle) { UI.regDashToggle.innerHTML = '<i class="fa-solid fa-chevron-left"></i>'; }
      }
    }

    if (esArchivoLocal()) {
      UI.regStatus.textContent = 'Abierto en file:// — no se pueden leer los datos';
      pintarAviso();
    }

    detectarBase().then(function () { iniciarCapas(map); });
  }

  /* Capas y datos: se ejecuta cuando ya se sabe dónde está la carpeta. */
  function iniciarCapas(map) {
    crearFondos();
    aplicarFondo(S.fondo, true);

    cargarEstados().then(function (gj) {
      if (!gj) { return; }
      S.capaLimites = crearLimites(gj);
      if (S.modo === 'registro') { S.capaLimites.addTo(map); S.capaLimites.bringToBack(); }
    });

    activarCobertura(S.cobertura);
    cargarCubo();
    actualizarBotonPredios();

    if (UI.regChkNacional && UI.regChkNacional.checked) {
      setTimeout(function () { cargarNacional(); }, 900);
    }

    console.info('[reg] Geoportal del Registro Agrario integrado. Carpeta de datos: ' + GEO);
  }

  function arrancar() {
    parchearGlobales();
    if (typeof L === 'undefined') {
      console.warn('[reg] Leaflet no está disponible; el visor usará la carta de respaldo.');
      return;
    }
    if (mapa()) { iniciar(); }
  }

  /* API pública mínima (para botones del HTML y para depurar) */
  window.regGeo = {
    iniciar: iniciar,
    setModo: setModo,
    toggleNacional: alternarNacional,
    tour: iniciarTour,
    cerrarTour: cerrarTour,
    irAPais: irAPais,
    fondo: aplicarFondo,
    estado: S,
    base: function () { return GEO; },
    rutas: function () { return RUTA; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
