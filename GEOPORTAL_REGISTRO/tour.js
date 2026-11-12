// Recorrido guiado interactivo del geoportal
// Señala cada control con un recuadro y un mensaje, paso a paso.

(function () {
  var PASOS = [
    { t: 'Bienvenida',
      x: 'Este geoportal muestra cómo se distribuyen los sujetos del registro agrario y qué superficie cubren. El recorrido dura un minuto y señala cada control.',
      sel: null },
    { t: 'Nivel territorial',
      x: 'Aquí eliges el ámbito: país, una de las siete regiones o uno de los estados. Al cambiar, el mapa se acerca y se cargan los registros de ese nivel.',
      sel: '#nivel' },
    { t: 'Cobertura por comuna',
      x: 'Esta capa pinta cada comuna según el porcentaje de su superficie que tiene registro agrario. Va de crema, cuando la cobertura es baja, a rojo oscuro cuando es alta.',
      sel: '#c-com' },
    { t: 'Otras coberturas',
      x: 'Puedes cambiar la escala de la cobertura: cuadrícula del país, por región o por estado. Cada una se prende y se apaga por separado.',
      sel: '#c-grid' },
    { t: 'Polígonos de registro',
      x: 'Con esta casilla se dibujan los polígonos de cada predio. Como los predios son pequeños, hay que acercar el mapa o tocar una comuna para verlos con forma.',
      sel: '#c-predios' },
    { t: 'Solo en comunas',
      x: 'Este filtro deja únicamente los registros que caen dentro de un polígono de comuna. Sirve para separar el registro comunalizado del que está fuera.',
      sel: '#f-comunas' },
    { t: 'Tipo de sujeto',
      x: 'Filtra por personas naturales, redes o sujetos jurídicos. Las comunas con RIF aparecen dentro de los jurídicos.',
      sel: '.f-tipo' },
    { t: 'Género del titular',
      x: 'Filtra por hombres o mujeres. El tablero y el contador se actualizan en el acto.',
      sel: 'input[name=genero]' },
    { t: 'Grupo de edad',
      x: 'Filtra jóvenes, adultos o adultos mayores. Se puede combinar con el género y el tipo de sujeto.',
      sel: 'input[name=edad]' },
    { t: 'Año del registro',
      x: 'Limita los registros a un año. 2014 concentra la mayor cantidad de solicitudes.',
      sel: '#anio' },
    { t: 'Tablero',
      x: 'Muestra los totales del nivel activo: registros, superficie, hombres y mujeres, con barras por género, edad y tipo de sujeto. Cambia cuando tocas una región o una comuna.',
      sel: '#dash' },
    { t: 'Listo',
      x: 'Eso es todo. Toca cualquier polígono para ver su ficha, y usa los filtros para responder preguntas concretas sobre el registro.',
      sel: null }
  ];

  var i = 0;
  var temporizador = null;
  var btnPlay = null;

  function reproducir() {
    btnPlay.textContent = '❚❚ Pausar';
    temporizador = setInterval(function () {
      if (i < PASOS.length - 1) { i++; pintar(); }
      else { parar(); }
    }, 6000);
  }

  function parar() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
    if (btnPlay) { btnPlay.textContent = '▶ Reproducir'; }
  }
  var overlay, caja, titulo, texto, contador, btnPrev, btnNext, foco = null;

  function construir() {
    overlay = document.createElement('div');
    overlay.id = 'tour-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,25,40,.45);z-index:5000;display:none';

    caja = document.createElement('div');
    caja.style.cssText = 'position:fixed;z-index:5100;max-width:340px;background:#fff;border-radius:10px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.3);padding:16px;font-family:Arial,Helvetica,sans-serif;display:none';
    caja.innerHTML =
      '<div id="tour-titulo" style="font-size:15px;font-weight:bold;color:#1f3b63;margin-bottom:6px"></div>' +
      '<div id="tour-texto" style="font-size:13px;color:#33465c;line-height:1.45"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:14px">' +
      '<span id="tour-contador" style="font-size:11px;color:#7a8797"></span>' +
      '<span style="flex:1"></span>' +
      '<button id="tour-play" style="padding:6px 10px;border:1px solid #c9d3de;background:#fff;border-radius:5px;cursor:pointer;font-size:12px">▶ Reproducir</button>' +
      '<button id="tour-prev" style="padding:6px 12px;border:1px solid #c9d3de;background:#fff;border-radius:5px;cursor:pointer;font-size:12px">Anterior</button>' +
      '<button id="tour-next" style="padding:6px 12px;border:none;background:#1f3b63;color:#fff;border-radius:5px;cursor:pointer;font-size:12px">Siguiente</button>' +
      '<button id="tour-close" style="padding:6px 8px;border:none;background:transparent;color:#7a8797;cursor:pointer;font-size:16px">×</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(caja);

    titulo = caja.querySelector('#tour-titulo');
    texto = caja.querySelector('#tour-texto');
    contador = caja.querySelector('#tour-contador');
    btnPrev = caja.querySelector('#tour-prev');
    btnNext = caja.querySelector('#tour-next');

    btnPlay = caja.querySelector('#tour-play');
    btnPlay.onclick = function () {
      if (temporizador) { parar(); } else { reproducir(); }
    };

    btnPrev.onclick = function () { if (i > 0) { i--; pintar(); } };
    btnNext.onclick = function () { if (i < PASOS.length - 1) { i++; pintar(); } else terminar(); };
    caja.querySelector('#tour-close').onclick = terminar;
  }

  function limpiarFoco() {
    if (foco) { foco.style.zIndex = ''; foco.style.position = ''; foco.style.boxShadow = ''; foco = null; }
  }

  function pintar() {
    var p = PASOS[i];
    if (btnPlay) btnPlay.textContent = temporizador ? '❚❚ Pausar' : '▶ Reproducir';
    titulo.textContent = p.t;
    texto.textContent = p.x;
    contador.textContent = (i + 1) + ' de ' + PASOS.length;
    btnPrev.disabled = (i === 0);
    btnPrev.style.opacity = (i === 0) ? '.4' : '1';
    btnNext.textContent = (i === PASOS.length - 1) ? 'Terminar' : 'Siguiente';

    limpiarFoco();

    if (!p.sel) {
      caja.style.left = (window.innerWidth / 2 - 170) + 'px';
      caja.style.top = (window.innerHeight / 2 - 110) + 'px';
      return;
    }

    var el = document.querySelector(p.sel);
    if (!el) { caja.style.left = '40px'; caja.style.top = '40px'; return; }

    el.style.position = 'relative';
    el.style.zIndex = '5050';
    el.style.boxShadow = '0 0 0 3px #ffb703, 0 0 0 8px rgba(255,183,3,.25)';

    var r = el.getBoundingClientRect();
    foco = el;

    var ancho = 340;
    var izq = r.right + 14;
    if (izq + ancho > window.innerWidth - 10) izq = Math.max(10, r.left - ancho - 14);
    var arriba = Math.min(Math.max(10, r.top - 10), window.innerHeight - 210);
    caja.style.left = izq + 'px';
    caja.style.top = arriba + 'px';
  }

  function empezar() {
    i = 0;
    overlay.style.display = 'block';
    caja.style.display = 'block';
    pintar();
  }

  function terminar() {
    parar();
    limpiarFoco();
    overlay.style.display = 'none';
    caja.style.display = 'none';
  }

  window.iniciarTour = function () {
    if (!overlay) construir();
    empezar();
  };
})();
