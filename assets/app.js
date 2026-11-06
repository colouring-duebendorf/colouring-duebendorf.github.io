/* Colouring Dübendorf – static replacement for the former ArcGIS Experience.
 * Data: data/*.geojson|json (exported once with tools/export_arcgis_data.py).
 * Libraries: Leaflet 1.9.4 and Chart.js 4.4.1, vendored under assets/vendor. */
(function () {
  'use strict';

  var NUM = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
  var NUM1 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
  var NO_DATA = 'Keine Angabe';
  var NO_DATA_COLOR = '#c8c8c8';
  // Buildings without a value: white with a grey outline, masking the basemap's black footprint.
  var UNSTYLED = { color: '#666', weight: 0.6, opacity: 0.8, fillColor: '#fff', fillOpacity: 0.9 };

  // Symbology copied from the original ArcGIS web maps.
  var THEMES = {
    typ: {
      field: 'Gebaeudetyp',
      title: 'Gebäudefläche nach Gebäudetyp (m²)',
      axis: 'Fläche (m²)',
      source: 'Quellen: Eidg. Gebäude- und Wohnungsregister – GWR',
      sort: 'value',
      classes: [
        ['Einfamilienhaus', '#ed5151'], ['Mehrfamilienhaus', '#149ece'], ['Industrie', '#a7c636'],
        ['Andere', '#9e559c'], ['Laden/Geschäft', '#fc921f'], ['Büro', '#ffde3e'],
        ['Restaurant', '#f789d8'], ['Schule', '#b7814a']
      ]
    },
    baujahr: {
      field: 'Baujahr',
      title: 'Gebäudefläche nach Baujahr (m²)',
      axis: 'Fläche (m²)',
      source: 'Quellen: Eidg. Gebäude- und Wohnungsregister – GWR',
      sort: 'legend',
      classes: [
        ['< 1919', '#9e559c'], ['1919 - 1945', '#6b6bd6'], ['1946 - 1960', '#ed5151'],
        ['1961 - 1970', '#a25091'], ['1971 - 1980', '#149ece'], ['1981 - 1985', '#a7c636'],
        ['1986 - 1990', '#ffde3e'], ['1991 - 1995', '#b7814a'], ['1996 - 2000', '#fc921f'],
        ['2001 - 2005', '#f789d8'], ['2006 - 2010', '#3caf99'], ['2011 - 2015', '#b54779'],
        ['> 2015', '#7f7f7f']
      ]
    },
    heizung: {
      field: 'Heizungsart',
      title: 'Gebäudefläche nach Heizungsart (m²)',
      axis: 'Fläche (m²)',
      source: 'Quellen: Eidg. Gebäude- und Wohnungsregister – GWR',
      sort: 'value',
      classes: [
        ['Gas', '#f22f00'], ['Heizöl', '#ffff80'], ['Unbestimmt', '#26ffff'],
        ['Fernwärme (generisch)', '#a040ff'], ['Holz (generisch)', '#d99800'],
        ['Elektrizität', '#0015ff'], ['Wärmepumpe (Luft)', '#5ff500']
      ],
      other: ['Andere', '#aaaaaa'] // ArcGIS default class: all remaining values incl. empty
    },
    pv: {
      field: 'PV_kW',
      title: 'Installierte PV-Leistung nach Gebäudetyp (kW)',
      axis: 'Leistung (kW)',
      source: 'Quelle PV-Anlagen: Elektrizitätsproduktionsanlagen in der Schweiz',
      ramp: [[4, '#fee5d9'], [11, '#fcae91'], [18, '#fb6a4a'], [25, '#de2d26'], [32, '#a50f15']]
    }
  };

  var state = { data: null, charts: {}, maps: {}, theme: 'typ' };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hexToRgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rampColor(ramp, v) {
    if (v <= ramp[0][0]) return ramp[0][1];
    for (var i = 1; i < ramp.length; i++) {
      if (v <= ramp[i][0]) {
        var t = (v - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]);
        var a = hexToRgb(ramp[i - 1][1]), b = hexToRgb(ramp[i][1]);
        return 'rgb(' + a.map(function (x, k) { return Math.round(x + (b[k] - x) * t); }).join(',') + ')';
      }
    }
    return ramp[ramp.length - 1][1];
  }

  // Map an attribute value to its legend class [label, color].
  function classify(theme, value) {
    var t = THEMES[theme];
    for (var i = 0; i < t.classes.length; i++) {
      if (t.classes[i][0] === value) return t.classes[i];
    }
    if (t.other) return t.other;
    return [NO_DATA, NO_DATA_COLOR];
  }

  // Building filter used by the original thematic layers.
  function isThematic(p) {
    return p.Zivilschutzraum == null && (p.Flaeche || 0) > 20;
  }

  function popupHtml(p) {
    var rows = [
      ['Adresse', p.Adresse],
      ['Gebäudetyp', p.Gebaeudetyp],
      ['Baujahr', p.Baujahr],
      ['Heizungsart', p.Heizungsart],
      ['Gebäudefläche (m²)', p.Flaeche == null ? null : NUM.format(p.Flaeche)],
      ['PV-Kapazität (kW)', p.PV_kW == null ? null : NUM1.format(p.PV_kW)]
    ];
    return '<h4>Gebäudeinformationen</h4><table class="popup-table">' + rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1] == null ? '–' : r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }

  // ---------- base map ----------
  function swisstopo(layer, ext, opacity) {
    return L.tileLayer('https://wmts.geo.admin.ch/1.0.0/' + layer + '/default/current/3857/{z}/{x}/{y}.' + ext, {
      maxNativeZoom: 19,
      maxZoom: 20,
      opacity: opacity || 1,
      attribution: '&copy; <a href="https://www.swisstopo.admin.ch/" target="_blank">swisstopo</a>'
    });
  }

  function createMap(el) {
    var grey = swisstopo('ch.swisstopo.pixelkarte-grau', 'jpeg', 0.55); // faded so the data colours stand out
    var map = L.map(el, { layers: [grey], zoomSnap: 0.25 });
    L.control.layers({
      'Landeskarte (grau)': grey,
      'Landeskarte (farbig)': swisstopo('ch.swisstopo.pixelkarte-farbe', 'jpeg'),
      'Luftbild': swisstopo('ch.swisstopo.swissimage', 'jpeg')
    }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.createPane('boundary').style.zIndex = 450;
    L.geoJSON(state.data.gfenn, {
      pane: 'boundary',
      interactive: false,
      style: { color: '#000', weight: 2, dashArray: '6 4', fill: false }
    }).addTo(map);
    map.fitBounds(L.geoJSON(state.data.gfenn).getBounds(), { padding: [10, 10] });
    return map;
  }

  function legendControl() {
    var c = L.control({ position: 'bottomright' });
    c.onAdd = function () {
      var div = L.DomUtil.create('div', 'legend');
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    return c;
  }

  var BOUNDARY_LEGEND = '<div class="row" style="margin-top:6px"><span class="line-swatch"></span>Quartier Gfenn</div>';

  // ---------- charts ----------
  function drawBarChart(key, canvasId, boxId, rows, axisLabel, decimals) {
    var fmt = decimals ? NUM1 : NUM;
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    document.getElementById(boxId).style.height = (rows.length * 30 + 50) + 'px';
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.label; }),
        datasets: [{
          data: rows.map(function (r) { return r.value; }),
          backgroundColor: rows.map(function (r) { return r.color; }),
          borderColor: 'rgba(0,0,0,0.25)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 20
        }]
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var share = total ? ' (' + NUM1.format(ctx.parsed.x / total * 100) + ' %)' : '';
                return ' ' + fmt.format(ctx.parsed.x) + ' ' + axisLabel.replace(/^.*\((.*)\)$/, '$1') + share;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: axisLabel, color: '#52606d' },
            ticks: { color: '#52606d', callback: function (v) { return fmt.format(v); } },
            grid: { color: '#eef2f6' }
          },
          y: { ticks: { color: '#1f2933' }, grid: { display: false } }
        }
      }
    });
    return total;
  }

  function tableHtml(rows, header, decimals) {
    var fmt = decimals ? NUM1 : NUM;
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    return '<table><thead><tr><th>Kategorie</th><th class="num">' + esc(header) + '</th><th class="num">Anteil</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td class="num">' + fmt.format(r.value) +
          '</td><td class="num">' + (total ? NUM1.format(r.value / total * 100) + ' %' : '–') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---------- page: Ihre Gebäude heute ----------
  function initGebaeude() {
    var map = createMap('map-gebaeude');
    var features = state.data.buildings.features.filter(function (f) { return isThematic(f.properties); });
    var layer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
      onEachFeature: function (f, l) { l.bindPopup(popupHtml(f.properties)); }
    }).addTo(map);
    var legend = legendControl().addTo(map);
    state.maps.gebaeude = { map: map, layer: layer, legend: legend, features: features };
  }

  function showTheme(theme) {
    var t = THEMES[theme];
    var g = state.maps.gebaeude;
    state.theme = theme;
    document.querySelectorAll('#page-gebaeude .tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.theme === theme));
    });

    // map style
    g.layer.setStyle(function (f) {
      var p = f.properties;
      if (theme === 'pv') {
        return p.PV_kW
          ? { color: '#333', weight: 0.8, fillColor: rampColor(t.ramp, p.PV_kW), fillOpacity: 1 }
          : UNSTYLED;
      }
      return { color: '#555', weight: 0.5, opacity: 0.6, fillColor: classify(theme, p[t.field])[1], fillOpacity: 1 };
    });

    // chart rows + legend
    var rows, html;
    if (theme === 'pv') {
      var sums = {};
      g.features.forEach(function (f) {
        var p = f.properties;
        if (!p.PV_kW) return;
        var k = p.Gebaeudetyp || NO_DATA;
        sums[k] = (sums[k] || 0) + p.PV_kW;
      });
      rows = Object.keys(sums).map(function (k) {
        return { label: k, value: sums[k], color: classify('typ', k)[1] };
      }).sort(function (a, b) { return b.value - a.value; });
      var n = g.features.filter(function (f) { return f.properties.PV_kW; }).length;
      html = '<h3>Installierte PV-Leistung (kW)</h3>' +
        '<div class="ramp" style="background:linear-gradient(to right,' + t.ramp.map(function (s) { return s[1]; }).join(',') + ')"></div>' +
        '<div class="ramp-labels"><span>≤ ' + t.ramp[0][0] + '</span><span>' + t.ramp[2][0] + '</span><span>≥ ' + t.ramp[4][0] + '</span></div>' +
        '<div class="row" style="margin-top:4px"><span class="swatch" style="background:#fff;border-color:#666"></span>Keine PV-Anlage</div>';
      document.getElementById('gebaeude-chart-note').textContent =
        n + ' Gebäude mit PV-Anlage, insgesamt ' + NUM.format(rows.reduce(function (s, r) { return s + r.value; }, 0)) + ' kW. Farben im Diagramm: Gebäudetyp.';
    } else {
      var acc = {};
      g.features.forEach(function (f) {
        var c = classify(theme, f.properties[t.field]);
        if (!acc[c[0]]) acc[c[0]] = { label: c[0], value: 0, count: 0, color: c[1] };
        acc[c[0]].value += f.properties.Flaeche || 0;
        acc[c[0]].count += 1;
      });
      var order = t.classes.map(function (c) { return c[0]; }).concat([t.other ? t.other[0] : NO_DATA]);
      rows = Object.keys(acc).map(function (k) { return acc[k]; });
      rows.sort(t.sort === 'legend'
        ? function (a, b) { return order.indexOf(a.label) - order.indexOf(b.label); }
        : function (a, b) { return b.value - a.value; });
      var present = rows.slice().sort(function (a, b) { return order.indexOf(a.label) - order.indexOf(b.label); });
      html = '<h3>' + esc(document.querySelector('#page-gebaeude .tabs [data-theme="' + theme + '"]').textContent) + '</h3>' +
        present.map(function (r) {
          return '<div class="row"><span class="swatch" style="background:' + r.color + '"></span>' + esc(r.label) + '</div>';
        }).join('');
      document.getElementById('gebaeude-chart-note').textContent =
        g.features.length + ' Gebäude im Quartier Gfenn (ohne Schutzräume und Kleinbauten ≤ 20 m²).';
    }
    g.legend.getContainer().innerHTML = html + BOUNDARY_LEGEND;

    document.getElementById('gebaeude-chart-title').textContent = t.title;
    document.getElementById('gebaeude-source').textContent = t.source;
    drawBarChart('gebaeude', 'gebaeude-chart', 'gebaeude-chart-box', rows, t.axis, theme === 'pv');
    document.getElementById('gebaeude-table').innerHTML = tableHtml(rows, t.axis, theme === 'pv');
  }

  // ---------- page: Stimmen aus dem Quartier ----------
  var SURVEY_COLORS = { 1: '#6baed6', 2: '#08519c' };
  var ANSWER_COLORS = { 'Ja': '#77b484', 'Nein': '#df6b35', 'Ich weiss nicht': '#5e8fd0' };

  function initStimmen() {
    var map = createMap('map-stimmen');
    var s = state.data.survey;
    var counts = s.antworten_pro_gebaeude;
    L.geoJSON(state.data.buildings, {
      style: function (f) {
        var c = counts[String(f.properties.id)];
        return c
          ? { color: '#555', weight: 0.6, fillColor: SURVEY_COLORS[Math.min(c, 2)], fillOpacity: 1 }
          : UNSTYLED;
      },
      onEachFeature: function (f, l) {
        var c = counts[String(f.properties.id)];
        l.bindPopup('<table class="popup-table"><tr><th>Adresse</th><td>' + esc(f.properties.Adresse || '–') +
          '</td></tr>' + (c ? '<tr><th>Umfrageantworten</th><td>' + c + '</td></tr>' : '') + '</table>');
      }
    }).addTo(map);
    var legend = legendControl().addTo(map);
    legend.getContainer().innerHTML = '<h3>Umfrageantworten pro Gebäude</h3>' +
      '<div class="row"><span class="swatch" style="background:' + SURVEY_COLORS[1] + '"></span>1 Antwort</div>' +
      '<div class="row"><span class="swatch" style="background:' + SURVEY_COLORS[2] + '"></span>2 Antworten</div>' +
      BOUNDARY_LEGEND;

    var rows = Object.keys(s.korrekt).map(function (k) {
      return { label: k, value: s.korrekt[k], color: ANSWER_COLORS[k] || NO_DATA_COLOR };
    }).sort(function (a, b) { return b.value - a.value; });
    document.getElementById('stimmen-note').textContent =
      'Ausgewertete Antworten: n = ' + s.metadata.records + '. ' +
      Object.keys(counts).length + ' Gebäude im Quartier haben an der Umfrage teilgenommen.';
    drawBarChart('stimmen', 'stimmen-chart', 'stimmen-chart-box', rows, 'Anzahl Antworten', false);
    document.getElementById('stimmen-table').innerHTML = tableHtml(rows, 'Antworten', false);
    state.maps.stimmen = { map: map };
  }

  // ---------- routing ----------
  var PAGES = ['projekt', 'gebaeude', 'umfrage', 'stimmen', 'szenarien'];

  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var page = PAGES.indexOf(parts[0]) >= 0 ? parts[0] : 'projekt';
    document.querySelectorAll('[data-page]').forEach(function (el) {
      el.classList.toggle('active', el.dataset.page === page);
    });
    document.querySelectorAll('.main-nav a').forEach(function (a) {
      if (a.getAttribute('href') === '#' + page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (!state.data) return; // data still loading; route() runs again afterwards

    if (page === 'gebaeude') {
      if (!state.maps.gebaeude) initGebaeude();
      state.maps.gebaeude.map.invalidateSize();
      var theme = THEMES[parts[1]] ? parts[1] : state.theme;
      showTheme(theme);
    } else if (page === 'stimmen') {
      if (!state.maps.stimmen) initStimmen();
      state.maps.stimmen.map.invalidateSize();
    }
  }

  document.querySelectorAll('#page-gebaeude .tabs button').forEach(function (b) {
    b.addEventListener('click', function () { location.hash = 'gebaeude/' + b.dataset.theme; });
  });
  window.addEventListener('hashchange', route);
  route();

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.json();
    });
  }

  Promise.all([
    getJson('data/gfenn.geojson'),
    getJson('data/buildings.geojson'),
    getJson('data/survey_summary.json')
  ]).then(function (res) {
    state.data = { gfenn: res[0], buildings: res[1], survey: res[2] };
    route();
  }).catch(function (err) {
    console.error(err);
    document.querySelectorAll('.map').forEach(function (m) {
      m.innerHTML = '<p style="padding:1rem">Die Kartendaten konnten nicht geladen werden.</p>';
    });
  });
})();
