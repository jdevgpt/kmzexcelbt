# KMZ + ANEXO III · Red BT

Webapp (GitHub Pages, instalable y sin conexión) que aplica los prompts maestros de red BT:

1. **Generar KMZ** – tabla de posiciones + tabla de defectos/ZOBX (opcional) + ZIP de fotos (opcional) → `PTxxxx - RED BT.kmz`
   (carpetas APOYOS / SALIDAS / CGP_CPM / ZOBX / DEFECTOS, iconos nativos de Google Earth, fotos embebidas en `files/`, leyenda).
2. **Generar ANEXO III** – sube el KMZ ya modificado en Google Earth → `ANEXO III - xxxx.xlsx` sobre la plantilla de 14 columnas con Q91X.
   DIST. se calcula con Haversine sobre las posiciones del KMZ; se avisa si la topología del KMZ no coincide con la tabla.

Todo se procesa en el navegador: los datos no salen del equipo.

- `js/core.js` – lógica (parseo, topología INICIO/FIN, defectos, fotos, KML, Excel). Sin dependencias del DOM.
- `js/app.js` – interfaz.
- `js/template.js` – plantilla ANEXO III embebida.
- `vendor/jszip.min.js` – JSZip 3.10.1 (MIT).

Para publicar una versión nueva: subir `APP_VERSION` en `js/app.js`, `version.json` y `CACHE` en `sw.js`.

JDev
