// charts.js
// Petite couche au-dessus de Chart.js pour créer/mettre à jour des
// graphiques en barres avec la palette du widget "Formulaire terrain",
// sans dupliquer la configuration à chaque appel.
(function (global) {
  'use strict';

  // Palette cyclique : suffisante pour un nombre raisonnable de
  // catégories (sites, services, formulaires). Si plus de catégories
  // sont présentes, les couleurs se répètent — acceptable pour ce
  // premier jet, à affiner si un site a un jour plus de 8 services.
  var PALETTE = [
    '#2B6E6B', // teal
    '#C4501E', // amber
    '#3C7A5B', // ok
    '#123634', // teal-deep
    '#6B675C', // muted
    '#8AA6A4',
    '#D98A5F',
    '#4F8F79'
  ];

  var GRID_COLOR = '#DCD6C7';
  var TEXT_COLOR = '#16302E';
  var FONT_FAMILY = "'Inter', system-ui, sans-serif";

  var instances = {};

  function colorFor(index) {
    return PALETTE[index % PALETTE.length];
  }

  // data: [{label, count}, ...] déjà trié/compté par data.js:countBy
  function renderBarChart(canvasId, data) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (instances[canvasId]) {
      instances[canvasId].destroy();
      delete instances[canvasId];
    }

    if (!data.length) return; // l'appelant affiche le message "aucune donnée"

    var labels = data.map(function (d) { return d.label; });
    var values = data.map(function (d) { return d.count; });
    var colors = data.map(function (d, i) { return colorFor(i); });

    instances[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderRadius: 6,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: { family: FONT_FAMILY },
            bodyFont: { family: FONT_FAMILY }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 12 } }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 12 } },
            grid: { color: GRID_COLOR }
          }
        }
      }
    });
  }

  global.DashboardCharts = {
    renderBarChart: renderBarChart,
    // Force chaque graphique existant à recalculer sa taille — utile
    // quand un graphique a été créé pendant que son onglet était encore
    // masqué (voir app-shell.js : les écrans non actifs se chargent en
    // arrière-plan dès le démarrage). Chart.js ne peut pas mesurer
    // correctement un canvas caché au moment de sa création ; sans cet
    // appel explicite au moment où l'onglet redevient visible, le
    // graphique reste bloqué avec une taille/mise en page incorrecte.
    resizeAll: function () {
      // Différé nécessaire : juste après avoir retiré "hidden" sur le
      // conteneur, le navigateur n'a pas forcément fini son recalcul de
      // mise en page — Chart.js mesurerait alors encore l'ancien
      // conteneur caché. Même principe que le délai appliqué à la
      // mini-carte Leaflet du widget Consultation (invalidateSize).
      setTimeout(function () {
        Object.keys(instances).forEach(function (id) {
          if (instances[id]) instances[id].resize();
        });
      }, 50);
    }
  };
})(window);
