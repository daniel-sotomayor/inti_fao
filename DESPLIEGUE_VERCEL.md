DESPLIEGUE EN VERCEL
====================
Este proyecto es un sitio estático (HTML + CSS + JS). En Vercel no hay que
compilar nada: se suben los archivos y Vercel los sirve por su CDN.

La configuración ya está hecha en `vercel.json` y `.vercelignore`; no tienes
que tocar nada más.


0. QUÉ SE SUBE Y QUÉ NO
-----------------------
Se publican (unos 170 MB, 615 archivos):

  index.html
  visor-registro.js · visor-registro.css
  INTI.jpg · 1.jpeg
  vercel.json
  GEOPORTAL_REGISTRO_SIN_INTERNET/
      datos/cubo.json                            0,9 MB
      datos/regiones.geojson                     0,2 MB
      datos/estados.geojson                      0,4 MB
      datos/comunas.geojson                      1,4 MB
      datos/predios/pais_100.geojson            13,5 MB
      datos/predios/01..24.geojson             ~146 MB
      vendor/leaflet.js + leaflet.css + teselas  6,6 MB

`.vercelignore` deja fuera `capturas/`, `tools/`, la documentación, la copia
`index copy.html` y la carpeta duplicada `GEOPORTAL_REGISTRO/` (163 MB, sin
teselas). Gracias a eso el despliegue no duplica los datos.

Límites de Vercel que sí importan (plan Hobby):
  · 100 MB por archivo  → el mayor aquí es 13,6 MB.
  · 15.000 archivos     → aquí hay ~615.
  · 100 GB al mes de transferencia → con ~3-4 MB por primera visita
    (los .geojson se comprimen), alcanza para decenas de miles de visitas.
  Las imágenes satelitales vienen de Esri, no consumen ancho de banda de Vercel.


1. OPCIÓN A (recomendada): GitHub + Vercel
------------------------------------------
Ventaja: cada `git push` vuelve a publicar el sitio solo.

Si YA tienes el repositorio (por ejemplo `daniel-sotomayor/inti_fao`):

     git add .vercelignore vercel.json .gitignore DESPLIEGUE_VERCEL.md README.md
     git commit -m "Configuración de despliegue en Vercel"
     git push

y salta al paso (c). Lo importante es que `.vercelignore` y `vercel.json`
queden en la raíz del repositorio.

Si empiezas de cero:

a) Crea un repositorio vacío en GitHub (sin README ni .gitignore).

b) Desde esta carpeta:

     git init
     git add -A
     git commit -m "Visor INTi-FAO con geoportal del Registro Agrario"
     git branch -M main
     git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
     git push -u origin main

   `.gitignore` ya deja fuera la carpeta duplicada y el material de apoyo;
   GitHub admite archivos de hasta 100 MB (el mayor es 13,6 MB).

c) En Vercel: https://vercel.com/new → Import Git Repository → elige el repo.

d) En la pantalla de configuración:
     Framework Preset ....... Other
     Build Command ........... (vacío)
     Output Directory ........ (vacío)
     Install Command ......... (vacío)
     Root Directory .......... ./
   Pulsa Deploy. En 1-2 minutos tendrás
     https://TU_PROYECTO.vercel.app

e) Opcional: Settings → Domains para usar un dominio propio (inti.gt.tc, etc.).


2. OPCIÓN B: CLI de Vercel (sin GitHub)
---------------------------------------
Necesitas Node.js instalado.

     npx vercel@latest login
     npx vercel@latest --prod

Respuestas sugeridas a las preguntas:
     Set up and deploy? .......................... Y
     Which scope? ................................ tu cuenta
     Link to existing project? ................... N
     What's your project's name? ................. visor-inti
     In which directory is your code located? .... ./
     Want to override the settings? .............. N

La primera vez crea un despliegue de previsualización y la segunda publica en
producción. La URL de producción se imprime al final.

Consejo: si algún día el proyecto crece a miles de archivos, añade
`--archive=tgz` para que la subida sea un solo archivo comprimido.

También puedes ejecutar `npx vercel@latest` (sin `--prod`) para una vista previa
y revisar todo antes de publicar.


3. QUE OTRAS PERSONAS LO VEAN
-----------------------------
Los despliegues de **producción** son públicos por omisión: comparte la URL
`https://TU_PROYECTO.vercel.app`.

Si al abrirla aparece una pantalla de Vercel pidiendo iniciar sesión, revisa
Settings → Deployment Protection y desactiva *Vercel Authentication* para
Production (en Hobby viene desactivada para producción; Preview sí suele estar
protegida).

La portada del panel pide usuario y clave (FAO2027 / FAO2027). Es sólo una
pantalla: la validación ocurre en el navegador y no protege los archivos. Para
restringir de verdad el acceso usa Deployment Protection (contraseña o SSO) o un
login del lado del servidor.


4. COMPROBAR EL DESPLIEGUE
--------------------------
1. Abre `https://TU_PROYECTO.vercel.app` y entra con FAO2027 / FAO2027.
2. Pestaña «MAPA INTERACTIVO». Arriba a la izquierda debe decir
   «440.790 registros · 14,60 M ha».
3. Pulsa el botón del estetoscopio (diagnóstico, junto al ▶). Debe responder
   «Datos accesibles: los 8 recursos del geoportal responden correctamente».
   Si en vez de eso sale un aviso rojo con archivos 404, es que la carpeta
   `GEOPORTAL_REGISTRO_SIN_INTERNET/datos` no llegó al despliegue: revisa que
   `.vercelignore` no la excluya y vuelve a desplegar.
4. Cambia entre los fondos Satélite / Cartográfico / INTi y toca un estado.


5. ACTUALIZAR EL SITIO
----------------------
  · Con GitHub: `git add -A && git commit -m "cambios" && git push`.
    Vercel reconstruye y publica solo.
  · Con CLI: `npx vercel@latest --prod` de nuevo.

Ojo con las cachés: `vercel.json` deja los datos 1 día en caché. Si actualizas
`datos/*`, espera ese plazo, cambia el nombre del archivo o publica con otra
ruta para forzar la recarga.

Nota sobre el repositorio: si ya subiste `GEOPORTAL_REGISTRO/` (163 MB, copia
sin teselas) y `index copy.html`, siguen en el historial de Git aunque
`.vercelignore` los mantenga fuera del despliegue. El sitio funciona igual. Si
quieres un repositorio más liviano para futuros clones:

     git rm -r --cached GEOPORTAL_REGISTRO "index copy.html"
     git commit -m "Quitar copia duplicada del repositorio"
     git push

(El historial anterior conserva esos archivos; para borrarlos de verdad haría
falta reescribir la historia con git filter-repo o BFG.)


6. PROBLEMAS FRECUENTES
-----------------------
· «Sin cubo de datos» o todo en cero:
    El navegador no pudo leer los .geojson. Abre el visor con la URL de Vercel
    (no con doble clic) y mira el aviso del panel: indica la ruta base y los
    archivos con error. Casi siempre es la carpeta de datos fuera del despliegue.

· Los mapas no aparecen pero los datos sí:
    Leaflet no cargó desde el CDN y tampoco desde `vendor/`. Comprueba que
    `GEOPORTAL_REGISTRO_SIN_INTERNET/vendor/leaflet.js` se subió.

· El fondo satélite queda en blanco:
    Esri no responde (red restringida). Cambia a «Cartográfico» o «INTi».

· Error por tamaño de archivo:
    Ningún archivo de este proyecto supera los 100 MB; si aparece, revisa que no
    se esté subiendo la carpeta duplicada `GEOPORTAL_REGISTRO/`.

· El plan Hobby es para uso personal. Para un sitio institucional (INTi/FAO)
    conviene un plan Pro.


7. ARCHIVOS DE CONFIGURACIÓN
----------------------------
`vercel.json`
  · `cleanUrls`: sirve `/` en lugar de `/index.html`.
  · Cabeceras: tipo `application/geo+json` para los .geojson (así Vercel los
    comprime), caché larga para teselas y datos, y cabeceras de seguridad.

`.vercelignore`
  · Excluye documentación, capturas, herramientas y la carpeta duplicada.
  · OJO: sustituye la lista por omisión, por eso incluye `.git`, `.vercel` y
    `node_modules`.

`.gitignore`
  · Evita subir a GitHub la carpeta duplicada y el material de apoyo.
