# KMZ + ANEXO III · Red BT

Webapp (GitHub Pages, instalable y sin conexión) que aplica los prompts maestros de red BT:

1. **Generar KMZ** – tabla de posiciones + tabla de defectos/ZOBX (opcional) + ZIP de fotos (opcional) → `ANEXO I - xxxx.kmz`
   (carpetas APOYOS / SALIDAS / CGP_CPM / ZOBX / DEFECTOS, iconos nativos de Google Earth, fotos embebidas en `files/`, leyenda).
2. **Generar ANEXO III** – sube el KMZ ya modificado en Google Earth → `ANEXO III - xxxx.xlsx` sobre la plantilla de 14 columnas con Q91X.
   Del KMZ salen posiciones (DIST. por Haversine), defectos (código, apoyo, descripción), observaciones y fotos; se avisa si la topología no coincide con la tabla.
   En FOTO se coloca dentro de la celda la foto que elijas en cada fila (viene preseleccionada la _1 del PT y la 1ª del defecto más grave).
3. **Enviar al Informe BT** – rellena el centro en la app InformesConBT (misma web): CD, fecha, dirección de la base de datos y tabla de defectos sin ZOBX.

Todo se procesa en el navegador: los datos no salen del equipo.

- `js/core.js` – lógica (parseo, topología INICIO/FIN, defectos, fotos, KML, Excel). Sin dependencias del DOM.
- `js/app.js` – interfaz.
- `js/template.js` – plantilla ANEXO III embebida.
- `vendor/jszip.min.js` – JSZip 3.10.1 (MIT).

Para publicar una versión nueva: subir `APP_VERSION` en `js/app.js`, `version.json` y `CACHE` en `sw.js`.

JDev
