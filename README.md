# inti_fao

Panel ejecutivo con el **geoportal del Registro Agrario** integrado en el visor
geográfico. Es un sitio **estático**: sólo HTML, CSS y JavaScript (sin Python,
sin PHP, sin base de datos), listo para publicarse en Vercel o en cualquier
hosting que sirva archivos.

## Qué incluye

- `index.html` — panel completo (resumen macro, visor, género, rubros, cronograma).
- `visor-registro.js` / `visor-registro.css` — geoportal del Registro Agrario:
  coberturas por región/estado/comuna, predios, filtros, tablero, tres fondos de
  mapa (satélite, cartográfico local e INTi), diagnóstico de datos y recorrido guiado.
- `GEOPORTAL_REGISTRO_SIN_INTERNET/` — datos (cubo, GeoJSON, predios), teselas
  locales y Leaflet de respaldo.
- `vercel.json` — configuración de despliegue (tipos MIME y cachés).
- `DESPLIEGUE_VERCEL.md` — guía paso a paso para publicarlo en Vercel.
- `LEEME-VISOR-REGISTRO.txt` — manual del visor, rutas de datos y limitaciones.

## Ver en local

Los `.geojson` no se pueden leer con `file://` (doble clic). Usa un servidor
estático:

```
node tools/servidor-local.cjs 8123
```

y abre <http://127.0.0.1:8123/index.html>.

## Publicar en Vercel

Sigue [`DESPLIEGUE_VERCEL.md`](DESPLIEGUE_VERCEL.md). En resumen:

1. Sube el proyecto a GitHub (o usa la CLI de Vercel).
2. En Vercel: **Add New → Project → Import**, sin build command ni output
   directory (es un sitio estático).
3. Comparte la URL de producción: `https://<proyecto>.vercel.app`.

## Acceso

La pantalla de acceso (`FAO2027` / `FAO2027`) es una portada visual: se valida en
el navegador y no protege los datos. Si necesitas restringir el sitio, usa
*Deployment Protection* de Vercel o un login real en el servidor.
