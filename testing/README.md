# Colouring Dübendorf – GitHub-Pages-only test version

Preview: https://colouring-duebendorf.github.io/testing/

Static replacement for the ArcGIS Online content (Experience Builder app and Survey123 forms).
The live site in the repository root is unchanged.

- `index.html` – platform shell; pages via `#projekt`, `#gebaeude[/typ|baujahr|heizung|pv]`, `#umfrage`, `#stimmen`, `#szenarien`
- `assets/app.js`, `assets/site.css` – maps, charts and layout
- `assets/vendor/` – Leaflet 1.9.4 and Chart.js 4.4.1 (MIT)
- `data/` – snapshot of the former ArcGIS layers (buildings, Gfenn boundary, aggregated survey counts),
  created with `tools/export_arcgis_data.py`
- `survey.html`, `raffle.html` – notices that the survey and raffle are closed

Reuses `../intoduction.html`, the poster PDF and the raffle conditions from the root.
Basemap: swisstopo Landeskarte / SWISSIMAGE (wmts.geo.admin.ch).
