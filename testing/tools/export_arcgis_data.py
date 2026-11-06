"""Snapshot the ArcGIS Online data used by the former Experience Builder app
into static files under ../data, so the site can run on GitHub Pages alone.

Run once (Python 3.8+, standard library only):

    python tools/export_arcgis_data.py

Outputs
  data/gfenn.geojson           Gfenn quarter boundary
  data/buildings.geojson       Building footprints with the attributes shown on the maps
  data/survey_summary.json     Aggregated survey results ("Stimmen aus dem Quartier")

Privacy: the survey export keeps only the number of responses per building and
the overall answer totals. Addresses and per-building answers are not written.
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date

SERVICES = "https://services6.arcgis.com/jUnz032bO8FYRBT9/arcgis/rest/services"
GFENN_URL = SERVICES + "/Gfenn/FeatureServer/0"
BUILDINGS_URL = SERVICES + "/aggregated_2025_08_18b/FeatureServer/0"
# The survey view is not public; the web map reached it through this proxy item.
SURVEY_URL = (
    "https://utility.arcgis.com/usrsvcs/servers/ef89176a56e9490b8d916303ba8bdb35"
    "/rest/services/CDubi_survey_V0m_Connect2_filtered/FeatureServer/0"
)

BUILDING_FIELDS = {
    # service field -> key written to GeoJSON
    "ObjectId": "id",
    "Adresse": "Adresse",
    "Gebäudetyp": "Gebaeudetyp",
    "Baujahr": "Baujahr",
    "Heizungsart": "Heizungsart",
    "Gebäudefläche": "Flaeche",
    "PV_capacity": "PV_kW",
    "Zivilschutzraum": "Zivilschutzraum",
}

MATCH_TOLERANCE_M = 2.0

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def query(layer_url, out_fields, fmt="geojson"):
    params = {
        "where": "1=1",
        "outFields": ",".join(out_fields),
        "returnGeometry": "true",
        "outSR": "4326",
        "geometryPrecision": "6",
        "resultRecordCount": "2000",
        "f": fmt,
    }
    url = layer_url + "/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "colouring-duebendorf-export"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    if "error" in data:
        sys.exit("ArcGIS error for %s: %s" % (layer_url, data["error"]))
    if data.get("exceededTransferLimit") or data.get("properties", {}).get("exceededTransferLimit"):
        sys.exit("Too many features in %s; add paging." % layer_url)
    return data


def clean_number(v, places):
    return None if v is None else round(float(v), places)


def write_json(name, obj):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote %-22s %7.1f KB" % (name, os.path.getsize(path) / 1024))


# --- geometry helpers for matching survey polygons to buildings -------------

def ring_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-18:
        xs, ys = zip(*ring)
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return cx / (3 * a), cy / (3 * a)


def outer_ring(geom):
    coords = geom["coordinates"]
    return coords[0] if geom["type"] == "Polygon" else coords[0][0]


def distance_m(a, b):
    # equirectangular approximation, accurate enough at building scale
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    today = date.today().isoformat()

    gfenn = query(GFENN_URL, ["ObjectId"])
    for f in gfenn["features"]:
        f["properties"] = {}
    gfenn["metadata"] = {"source": GFENN_URL, "exported": today}
    write_json("gfenn.geojson", gfenn)

    bld = query(BUILDINGS_URL, list(BUILDING_FIELDS))
    for f in bld["features"]:
        p = f["properties"]
        f["properties"] = {BUILDING_FIELDS[k]: p.get(k) for k in BUILDING_FIELDS}
        f["properties"]["Flaeche"] = clean_number(f["properties"]["Flaeche"], 0)
        f["properties"]["PV_kW"] = clean_number(f["properties"]["PV_kW"], 2)
        f.pop("id", None)
    bld["metadata"] = {
        "source": BUILDINGS_URL,
        "exported": today,
        "sources": "Eidg. Gebäude- und Wohnungsregister (GWR); "
                   "Elektrizitätsproduktionsanlagen in der Schweiz",
    }
    write_json("buildings.geojson", bld)

    # The survey view reuses the building footprints, so each survey polygon is
    # matched to the building whose centroid coincides with its own.
    survey = query(SURVEY_URL, ["survey_count", "waren_diese_angaben_korrekt"])
    centroids = [(ring_centroid(outer_ring(b["geometry"])), b["properties"]["id"])
                 for b in bld["features"]]
    by_building = {}
    unmatched = no_geometry = 0
    for f in survey["features"]:
        if not f.get("geometry"):
            # still counted in the answer totals, but cannot be placed on the map
            no_geometry += 1
            continue
        pt = ring_centroid(outer_ring(f["geometry"]))
        dist, bid = min((distance_m(pt, c), i) for c, i in centroids)
        if dist > MATCH_TOLERANCE_M:
            unmatched += 1
            continue
        bid = str(bid)
        count = int(f["properties"]["survey_count"] or 0)
        by_building[bid] = max(by_building.get(bid, 0), count)
    answers = Counter(f["properties"]["waren_diese_angaben_korrekt"] or "Keine Angabe"
                      for f in survey["features"])
    write_json("survey_summary.json", {
        "metadata": {"source": "CDubi_survey_V0m_Connect2_filtered", "exported": today,
                     "records": len(survey["features"])},
        "korrekt": dict(answers.most_common()),
        "antworten_pro_gebaeude": by_building,
    })
    print("survey records: %d, without geometry: %d, matched buildings: %d, unmatched: %d"
          % (len(survey["features"]), no_geometry, len(by_building), unmatched))


if __name__ == "__main__":
    main()
