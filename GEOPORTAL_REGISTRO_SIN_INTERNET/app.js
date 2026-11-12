// Geoportal del Registro Agrario v4
// Tablero alimentado por un cubo agregado: responde a los filtros, incluido el año.

if (!window.L) {
  document.getElementById('panel').innerHTML =
    '<h1>No se pudo cargar la librería del mapa</h1>' +
    '<div class="sub">Se necesita conexión a internet para la librería y los mapas base.</div>';
  throw new Error('Leaflet no disponible');
}

var TIPOS = ['Natural', 'Red', 'Jurídico'];
var ESTILO_BORDE = { color: '#8a6a4a', weight: 0.9, fillColor: 'transparent', fillOpacity: 0 };
var coloresActivos = true;
var CUBO = null;

var ESTADOS = [
  ['01','Distrito Capital'],['02','Amazonas'],['03','Anzoátegui'],['04','Apure'],['05','Aragua'],
  ['06','Barinas'],['07','Bolívar'],['08','Carabobo'],['09','Cojedes'],['10','Delta Amacuro'],
  ['11','Falcón'],['12','Guárico'],['13','Lara'],['14','Mérida'],['15','Miranda'],['16','Monagas'],
  ['17','Nueva Esparta'],['18','Portuguesa'],['19','Sucre'],['20','Táchira'],['21','Trujillo'],
  ['22','Yaracuy'],['23','Zulia'],['24','La Guaira'],['26','Ezequibo']
];

var REGIONES = [
  ['CENTRAL', 'Región Central', ['01','05','08','15','22','24']],
  ['GUAYANA', 'Región Guayana', ['02','07','10']],
  ['LOS ANDES', 'Región Los Andes', ['14','20','21']],
  ['LOS LLANOS', 'Región Los Llanos', ['04','06','09','12','18']],
  ['OCCIDENTAL', 'Región Occidental', ['11','13','23']],
  ['ORIENTAL', 'Región Oriental', ['03','16','17','19']],
  ['EZEQUIBO', 'Región Ezequibo', ['26']]
];

var ANIOS = [2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026];

function num(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('es-VE'); }
function dec(n) { return (n === null || n === undefined) ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }); }

var map = L.map('mapa', { zoomControl: false }).setView([7.8, -66.0], 6);

var osm = L.tileLayer('vendor/tiles/{z}/{x}/{y}.png',
  { maxZoom: 16, maxNativeZoom: 9, attribution: '© OpenStreetMap' }).addTo(map);
var satelite = L.tileLayer('vendor/tiles/{z}/{x}/{y}.png',
  { maxZoom: 16, maxNativeZoom: 9, attribution: '© OpenStreetMap' });
var blanco = L.tileLayer('', { attribution: '' });

L.control.layers({ 'Mapa base': osm, 'Sin fondo': blanco },
  {}, { position: 'topright', collapsed: true }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

// ---------- herramientas de navegacion ----------
var Herramientas = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    var div = L.DomUtil.create('div', 'leaflet-bar herramientas');
    div.innerHTML =
      '<a href="#" id="hz-in" title="Acercar">+</a>' +
      '<a href="#" id="hz-out" title="Alejar">&#8722;</a>' +
      '<a href="#" id="hz-mano" title="Mover el mapa">&#9995;</a>' +
      '<a href="#" id="hz-punta" title="Seleccionar" class="activo">&#9650;</a>';
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  }
});
map.addControl(new Herramientas());

var manoActiva = false;

function activarMano(estado) {
  manoActiva = estado;
  map.getContainer().style.cursor = estado ? 'grab' : '';
  document.getElementById('hz-mano').classList.toggle('activo', estado);
  document.getElementById('hz-punta').classList.toggle('activo', !estado);
  if (estado) { map.dragging.enable(); } else { map.dragging.enable(); }
}

document.getElementById('hz-in').addEventListener('click', function (e) {
  e.preventDefault(); map.zoomIn();
});
document.getElementById('hz-out').addEventListener('click', function (e) {
  e.preventDefault(); map.zoomOut();
});
document.getElementById('hz-mano').addEventListener('click', function (e) {
  e.preventDefault(); activarMano(true);
});
document.getElementById('hz-punta').addEventListener('click', function (e) {
  e.preventDefault(); activarMano(false);
});

// ---------- plegar el panel ----------
document.getElementById('btn-plegar').addEventListener('click', function (e) {
  e.preventDefault();
  var panel = document.getElementById('panel');
  var plegado = panel.classList.toggle('plegado');
  this.textContent = plegado ? '\u00bb' : '\u00ab';
  setTimeout(function () { map.invalidateSize(); }, 200);
});

function colorCob(valor, max) {
  var t = Math.max(0, Math.min(1, (valor || 0) / (max || 1)));
  var ini = [255, 242, 224], fin = [127, 39, 4];
  var r = Math.round(ini[0] + (fin[0]-ini[0])*t);
  var g = Math.round(ini[1] + (fin[1]-ini[1])*t);
  var b = Math.round(ini[2] + (fin[2]-ini[2])*t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function popupCob(p, etiqueta, nombre) {
  var cob = '';
  if (p.pct_cob !== undefined && p.pct_cob !== null) {
    cob = (p.pct_cob > 100)
      ? 'más de 100 % (los predios se solapan)'
      : dec(p.pct_cob) + ' %';
  }
  return '<div class="popup-tit">' + etiqueta + ': ' + nombre + '</div>' +
    '<table class="popup-tabla">' +
    '<tr><td>Superficie registrada</td><td>' + num(p.ha_total) + ' ha</td></tr>' +
    (p.ha_area ? '<tr><td>Superficie de la unidad</td><td>' + num(p.ha_area) + ' ha</td></tr>' : '') +
    (cob ? '<tr><td>Cobertura</td><td>' + cob + '</td></tr>' : '') +
    '</table>';
}

function capaCobertura(url, etiqueta, campo, nombreCampo, nivel) {
  var capa = L.geoJSON(null, {
    style: function (f) {
      return { color: '#8a6a4a', weight: 0.6,
               fillColor: colorCob(f.properties.ha_total, capa._max || 1), fillOpacity: 0.62 };
    },
    onEachFeature: function (f, layer) {
      var p = f.properties;
      var nombre = p[nombreCampo] || '—';
      layer.bindPopup(popupCob(p, etiqueta, nombre));
      layer.on('click', function () {
        if (manoActiva) return;
        var clave = (nivel === 'comuna' && p.id_comuna !== undefined)
          ? String(p.id_comuna)
          : String(nombre).toUpperCase();

        if (nivel === 'estado' && p.cod_est) {
          cargarPredios([p.cod_est], { tipo: 'estado', nombre: nombre,
                                       unidad: clave, cod: p.cod_est },
                        layer.getBounds());
          return;
        }

        if (nivel === 'region') {
          var reg = REGIONES.filter(function (r) { return r[0] === clave; })[0];
          if (reg) {
            cargarPredios(reg[2], { tipo: 'region', nombre: nombre, unidad: clave },
                          layer.getBounds());
            return;
          }
        }

        // comuna
        if (!datosPredios) {
          var est = ESTADOS.filter(function (e) {
            return e[1].toUpperCase() === String(p.estado || '').toUpperCase();
          })[0];
          if (est) {
            cargarPredios([est[0]], { tipo: 'comuna', nombre: nombre, unidad: clave },
                          layer.getBounds());
            return;
          }
        }

        contexto = { tipo: nivel, nombre: nombre, unidad: clave };
        refrescar();
        try { map.fitBounds(layer.getBounds(), { padding: [10, 10] }); } catch (e) {}
      });
    }
  });
  fetch(url).then(function (r) { return r.json(); })
    .then(function (j) {
      var max = 0;
      j.features.forEach(function (f) {
        max = Math.max(max, f.properties.ha_total || 0);
      });
      capa._max = max;
      capa.addData(j);
      if (!coloresActivos) capa.setStyle(ESTILO_BORDE);
    })
    .catch(function (e) { console.error(url, e); });
  return capa;
}

var capaReg = capaCobertura('datos/regiones.geojson', 'Región', 'pct_cob', 'region', 'region');
var capaEst = capaCobertura('datos/estados.geojson', 'Estado', 'pct_cob', 'estado', 'estado');
var capaCom = capaCobertura('datos/comunas.geojson', 'Comuna', 'pct_cob', 'comuna', 'comuna');

function popupPredio(p) {
  var titulo = (p.predio && p.predio !== 'S/N') ? p.predio : 'Predio sin nombre';
  return '<div class="popup-tit">' + titulo + '</div>' +
    '<table class="popup-tabla">' +
    '<tr><td>Titular</td><td>' + (p.productor || '—') + '</td></tr>' +
    '<tr><td>Tipo de sujeto</td><td>' + (p.tipo_de_sujeto || '—') + '</td></tr>' +
    '<tr><td>Género</td><td>' + (p.sexo === 'M' ? 'Hombre' : p.sexo === 'F' ? 'Mujer' : '—') + '</td></tr>' +
    '<tr><td>Edad</td><td>' + (p.edad ? p.edad + ' años' : '—') + '</td></tr>' +
    '<tr><td>Superficie</td><td>' + dec(p.ha) + ' ha</td></tr>' +
    '<tr><td>Año</td><td>' + (p.anio || '—') + '</td></tr>' +
    '<tr><td>Comuna</td><td>' + (p.comuna || 'Fuera de comuna') + '</td></tr>' +
    '<tr><td>ID del registro</td><td>' + num(p.id_predio) + '</td></tr>' +
    '</table>';
}

var ESTILO_PREDIO = { color: '#4a2f0c', weight: 0.9, fillColor: '#e0952a', fillOpacity: 0.75 };

var capaPredios = L.geoJSON(null, {
  style: ESTILO_PREDIO,
  onEachFeature: function (f, layer) { layer.bindPopup(popupPredio(f.properties)); }
});

var capaNacional = L.geoJSON(null, {
  style: ESTILO_PREDIO,
  onEachFeature: function (f, layer) { layer.bindPopup(popupPredio(f.properties)); }
});

var datosNacional = null;

var contexto = { tipo: 'pais', nombre: 'Nivel país', unidad: 'PAIS' };
var datosPredios = null;

var selAnio = document.getElementById('anio');
ANIOS.forEach(function (a) {
  var o = document.createElement('option');
  o.value = a; o.textContent = a;
  selAnio.appendChild(o);
});

function filtros() {
  var tipos = Array.prototype.slice.call(document.querySelectorAll('.f-tipo:checked'))
    .map(function (c) { return c.value; });
  return { tipos: tipos,
           genero: document.querySelector('input[name=genero]:checked').value,
           edad: document.querySelector('input[name=edad]:checked').value,
           anio: selAnio.value,
           soloComunas: document.getElementById('f-comunas').checked };
}

function cumpleEdad(edad, grupo) {
  if (!grupo) return true;
  if (edad === null || edad === undefined) return false;
  if (grupo === 'joven') return edad >= 18 && edad <= 29;
  if (grupo === 'adulto') return edad >= 30 && edad <= 59;
  if (grupo === 'mayor') return edad >= 60;
  return true;
}

function statsCubo(nivelKey, unidad) {
  var f = filtros();
  var s = { n_total: 0, ha_total: 0, n_hombres: 0, n_mujeres: 0, n_jovenes: 0, n_adultos: 0,
            n_mayores: 0, n_natural: 0, n_red: 0, n_juridico: 0 };
  if (!CUBO) return s;
  var grupo = (CUBO[nivelKey] || {})[unidad] || [];
  grupo.forEach(function (r) {
    if (f.anio && r[0] !== Number(f.anio)) return;
    if (f.tipos.indexOf(TIPOS[r[1]]) === -1) return;
    if (f.genero && ['M','F'][r[2]] !== f.genero) return;
    if (f.edad && ['joven','adulto','mayor','sin'][r[3]] !== f.edad) return;
    var n = r[4], ha = r[5];
    s.n_total += n; s.ha_total += ha;
    if (r[1] === 0) s.n_natural += n;
    if (r[1] === 1) s.n_red += n;
    if (r[1] === 2) s.n_juridico += n;
    if (r[2] === 0) s.n_hombres += n;
    if (r[2] === 1) s.n_mujeres += n;
    if (r[3] === 0) s.n_jovenes += n;
    if (r[3] === 1) s.n_adultos += n;
    if (r[3] === 2) s.n_mayores += n;
  });
  return s;
}

function statsPredios(feats) {
  var s = { n_total: 0, ha_total: 0, n_hombres: 0, n_mujeres: 0, n_jovenes: 0, n_adultos: 0,
            n_mayores: 0, n_natural: 0, n_red: 0, n_juridico: 0 };
  feats.forEach(function (ft) {
    var p = ft.properties;
    s.n_total++;
    s.ha_total += Number(p.ha) || 0;
    if (p.sexo === 'M') s.n_hombres++;
    if (p.sexo === 'F') s.n_mujeres++;
    if (p.edad >= 18 && p.edad <= 29) s.n_jovenes++;
    if (p.edad >= 30 && p.edad <= 59) s.n_adultos++;
    if (p.edad >= 60) s.n_mayores++;
    if (p.tipo_de_sujeto === 'Natural') s.n_natural++;
    if (p.tipo_de_sujeto === 'Red') s.n_red++;
    if (p.tipo_de_sujeto === 'Jurídico') s.n_juridico++;
  });
  return s;
}

function barras(destino, filas) {
  var max = Math.max.apply(null, filas.map(function (f) { return f[1] || 0; }).concat([1]));
  document.getElementById(destino).innerHTML = filas.map(function (f) {
    var w = 100 * (f[1] || 0) / max;
    return '<div class="fila"><span>' + f[0] + '</span>' +
           '<span class="bar"><span style="width:' + w.toFixed(1) + '%"></span></span>' +
           '<span class="n">' + num(f[1]) + '</span></div>';
  }).join('');
}

function tarjeta(v, l) {
  return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
}

function actualizarDash() {
  var s, titulo;

  if (contexto.tipo === 'comuna') {
    s = statsCubo('comuna', contexto.unidad);
    if (!s.n_total && datosPredios) {
      var enComuna = datosPredios.features.filter(function (ft) {
        return ft.properties.comuna === contexto.nombre;
      });
      if (enComuna.length) s = statsPredios(enComuna);
    }
    titulo = 'Comuna: ' + contexto.nombre;
  } else if (contexto.tipo === 'region') {
    s = statsCubo('region', contexto.unidad);
    titulo = 'Región: ' + contexto.nombre;
  } else if (contexto.tipo === 'estado') {
    s = statsCubo('estado', contexto.unidad);
    titulo = 'Estado: ' + contexto.nombre;
  } else {
    s = statsCubo('pais', 'PAIS');
    titulo = 'Nivel país';
  }

  document.getElementById('dash-titulo').textContent = titulo;
  document.getElementById('dash-kpis').innerHTML =
    tarjeta(num(s.n_total), 'Registros') +
    tarjeta(num(Math.round(s.ha_total)), 'Superficie (ha)') +
    tarjeta(num(s.n_hombres), 'Hombres') +
    tarjeta(num(s.n_mujeres), 'Mujeres');

  barras('dash-genero', [['Hombres', s.n_hombres], ['Mujeres', s.n_mujeres]]);
  barras('dash-edad', [['Jóvenes', s.n_jovenes], ['Adultos', s.n_adultos], ['Mayores', s.n_mayores]]);
  barras('dash-tipo', [['Naturales', s.n_natural], ['Redes', s.n_red], ['Jurídicos', s.n_juridico]]);
}

function actualizarResumen(n, ha) {
  document.getElementById('filtro-resumen').innerHTML =
    'Polígonos visibles: <b>' + num(n) + '</b> · <b>' + num(Math.round(ha)) + '</b> ha';
}

function pasaFiltros(p, f) {
  if (f.tipos.indexOf(p.tipo_de_sujeto) === -1) return false;
  if (f.genero && p.sexo !== f.genero) return false;
  if (!cumpleEdad(p.edad, f.edad)) return false;
  if (f.anio && String(p.anio) !== String(f.anio)) return false;
  if (f.soloComunas && !p.comuna) return false;
  if (contexto.tipo === 'estado' && contexto.cod && p._cod && p._cod !== contexto.cod) return false;
  if (contexto.tipo === 'comuna' && p.comuna !== contexto.nombre) return false;
  return true;
}

function aplicarFiltros() {
  var f = filtros();
  var total = 0, hectareas = 0;

  if (datosPredios) {
    var vis = datosPredios.features.filter(function (ft) { return pasaFiltros(ft.properties, f); });
    capaPredios.clearLayers();
    capaPredios.addData({ type: 'FeatureCollection', features: vis });
    if (document.getElementById('c-predios').checked && !map.hasLayer(capaPredios)) capaPredios.addTo(map);
    capaPredios.bringToFront();
    total = vis.length;
    hectareas = vis.reduce(function (a, ft) { return a + (Number(ft.properties.ha) || 0); }, 0);
  }

  if (datosNacional) {
    var visN = datosNacional.features.filter(function (ft) { return pasaFiltros(ft.properties, f); });
    capaNacional.clearLayers();
    capaNacional.addData({ type: 'FeatureCollection', features: visN });
    if (document.getElementById('c-nacional').checked && !map.hasLayer(capaNacional)) capaNacional.addTo(map);
    if (map.hasLayer(capaNacional)) capaNacional.bringToFront();
    if (!datosPredios) {
      total = visN.length;
      hectareas = visN.reduce(function (a, ft) { return a + (Number(ft.properties.ha) || 0); }, 0);
    }
  }

  actualizarResumen(total, hectareas);
}

function refrescar() { actualizarDash(); aplicarFiltros(); }

function actualizarLeyenda() {
  var l = document.getElementById('leyenda');
  if (!coloresActivos) { l.style.display = 'none'; return; }
  var capa = null, titulo = '';
  if (map.hasLayer(capaCom)) { capa = capaCom; titulo = 'Superficie registrada por comuna'; }
  else if (map.hasLayer(capaEst)) { capa = capaEst; titulo = 'Superficie registrada por estado'; }
  else if (map.hasLayer(capaReg)) { capa = capaReg; titulo = 'Superficie registrada por región'; }
  if (!capa) { l.style.display = 'none'; return; }
  document.getElementById('leyenda-titulo').textContent = titulo;
  document.getElementById('leyenda-min').textContent = '0 ha';
  document.getElementById('leyenda-max').textContent = num(Math.round(capa._max)) + ' ha';
  l.style.display = 'block';
}

function cargarPredios(codigos, etiqueta, bounds) {
  var info = document.getElementById('carga');
  info.textContent = 'Cargando registros…';
  var acumulado = [];
  var pendientes = codigos.slice();

  function siguiente() {
    if (!pendientes.length) {
      datosPredios = { type: 'FeatureCollection', features: acumulado };
      contexto = { tipo: etiqueta.tipo, nombre: etiqueta.nombre,
                   unidad: etiqueta.unidad, cod: etiqueta.cod };
      refrescar();
      info.textContent = num(acumulado.length) + ' registros cargados';
      var destino = bounds;
      if (!destino && capaPredios.getLayers().length) {
        try { destino = capaPredios.getBounds(); } catch (e) { destino = null; }
      }
      if (destino) map.fitBounds(destino, { padding: [20, 20] });
      return;
    }
    var cod = pendientes.shift();
    fetch('datos/predios/' + cod + '.geojson')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        j.features.forEach(function (ft) { ft.properties._cod = cod; });
        acumulado = acumulado.concat(j.features);
        siguiente();
      })
      .catch(function () { siguiente(); });
  }
  siguiente();
}

function cargarNacional() {
  var info = document.getElementById('carga');
  var chk = document.getElementById('c-nacional');

  if (datosNacional) {
    aplicarFiltros();
    if (chk.checked && !map.hasLayer(capaNacional)) { capaNacional.addTo(map); capaNacional.bringToFront(); }
    info.textContent = num(datosNacional.features.length) + ' registros nacionales (100 ha o más)';
    return;
  }

  info.textContent = 'Cargando registro nacional…';
  fetch('datos/predios/pais_100.geojson')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      j.features.forEach(function (ft) { ft.properties._cod = ft.properties.cod_est; });
      datosNacional = j;
      aplicarFiltros();
      if (chk.checked) { capaNacional.addTo(map); capaNacional.bringToFront(); }
      info.textContent = num(j.features.length) + ' registros nacionales (100 ha o más)';
    })
    .catch(function () { info.textContent = 'No se pudo cargar el registro nacional'; });
}

function boundsDeUnidad(capa, campo, valor) {
  var caja = null;
  try {
    capa.eachLayer(function (l) {
      if (l.feature && l.feature.properties[campo] === valor && l.getBounds) {
        var b = l.getBounds();
        caja = caja ? caja.extend(b) : b.clone();
      }
    });
  } catch (e) { caja = null; }
  return caja;
}

function conmutar(id, capa) {
  document.getElementById(id).addEventListener('change', function (e) {
    var otras = [
      { id: 'c-reg', capa: capaReg },
      { id: 'c-est', capa: capaEst },
      { id: 'c-com', capa: capaCom }
    ].filter(function (o) { return o.id !== id; });

    if (e.target.checked) {
      // solo una cobertura a la vez
      otras.forEach(function (o) {
        document.getElementById(o.id).checked = false;
        if (map.hasLayer(o.capa)) map.removeLayer(o.capa);
      });
      capa.addTo(map);
      capa.bringToFront();
      if (!coloresActivos) capa.setStyle(ESTILO_BORDE);
      if (datosPredios) capaPredios.bringToFront();
    } else {
      map.removeLayer(capa);
    }
    actualizarLeyenda();
  });
}
function pintarColores(activo) {
  [capaReg, capaEst, capaCom].forEach(function (c) {
    if (activo) {
      c.setStyle(c.options.style);
    } else {
      c.setStyle(ESTILO_BORDE);
    }
  });
}

document.getElementById('btn-color').addEventListener('click', function () {
  coloresActivos = !coloresActivos;
  pintarColores(coloresActivos);
  this.textContent = coloresActivos ? 'Quitar colores' : 'Poner colores';
  actualizarLeyenda();
});

conmutar('c-reg', capaReg);
conmutar('c-est', capaEst);
conmutar('c-com', capaCom);

document.getElementById('c-nacional').addEventListener('change', function (e) {
  if (e.target.checked) {
    if (!datosNacional) cargarNacional();
    else {
      if (!map.hasLayer(capaNacional)) { capaNacional.addTo(map); capaNacional.bringToFront(); }
    }
  } else if (map.hasLayer(capaNacional)) {
    map.removeLayer(capaNacional);
  }
});

document.getElementById('c-predios').addEventListener('change', function (e) {
  if (e.target.checked && datosPredios) { capaPredios.addTo(map); capaPredios.bringToFront(); }
  if (!e.target.checked) map.removeLayer(capaPredios);
});

document.getElementById('f-comunas').addEventListener('change', refrescar);
document.querySelectorAll('.f-tipo').forEach(function (c) { c.addEventListener('change', refrescar); });
document.querySelectorAll('input[name=genero]').forEach(function (c) { c.addEventListener('change', refrescar); });
document.querySelectorAll('input[name=edad]').forEach(function (c) { c.addEventListener('change', refrescar); });
selAnio.addEventListener('change', refrescar);

document.getElementById('btn-plegar-dash').addEventListener('click', function (e) {
  e.preventDefault();
  var d = document.getElementById('dash');
  var plegado = d.classList.toggle('plegado');
  this.textContent = plegado ? '\u00ab' : '\u00bb';
});

document.getElementById('btn-pais').addEventListener('click', function () {
  capaPredios.clearLayers();
  datosPredios = null;
  if (map.hasLayer(capaPredios)) map.removeLayer(capaPredios);
  contexto = { tipo: 'pais', nombre: 'Nivel país', unidad: 'PAIS' };
  document.getElementById('c-nacional').checked = true;
  cargarNacional();
  actualizarDash();
  map.fitBounds([[0.6, -73.4], [12.2, -58.1]], { padding: [10, 10] });
});

document.getElementById('btn-limpiar').addEventListener('click', function () {
  document.querySelectorAll('.f-tipo').forEach(function (c) { c.checked = true; });
  document.querySelector('input[name=genero][value=""]').checked = true;
  document.querySelector('input[name=edad][value=""]').checked = true;
  selAnio.value = '';
  document.getElementById('f-comunas').checked = false;
  refrescar();
});

fetch('datos/cubo.json')
  .then(function (r) { return r.json(); })
  .then(function (j) { CUBO = j; actualizarDash(); })
  .catch(function (e) { console.error('cubo', e); });

capaCom.addTo(map);
cargarNacional();
actualizarLeyenda();
actualizarDash();
actualizarResumen(0, 0);
map.fitBounds([[0.6, -73.4], [12.2, -58.1]], { padding: [10, 10] });
