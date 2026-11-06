# colouring-duebendorf.github.io
the link to colouring dubendorf platform

The platform is a static GitHub Pages site (no ArcGIS Online dependency):

- `index.html` – platform shell; pages via `#projekt`, `#gebaeude[/typ|baujahr|heizung|pv]`, `#umfrage`, `#stimmen`, `#szenarien`
- `intoduction.html` – "Über das Projekt" text (also used by the old version)
- `ergebnisse.html` – standalone "Zukünftige Szenarien & Ergebnisse" page for embedding
- `assets/app.js`, `assets/site.css` – maps, charts and layout
- `assets/vendor/` – Leaflet 1.9.4 and Chart.js 4.4.1 (MIT)
- `data/` – snapshot of the former ArcGIS layers (buildings, Gfenn boundary, aggregated survey counts),
  created with `tools/export_arcgis_data.py`
- `survey.html`, `raffle.html` – notices that the survey and raffle are closed
- `v1/` – previous version (ArcGIS Experience Builder and Survey123 embeds)
- `testing/` – redirects from the former test URLs

Basemap: swisstopo Landeskarte / SWISSIMAGE (wmts.geo.admin.ch).
