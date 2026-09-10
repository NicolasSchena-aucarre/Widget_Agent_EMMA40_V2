// app.js
// Orchestration du widget : connexion à Grist, filtres Site / Service en
// cascade, et déclenchement du rendu des 3 graphiques à chaque
// changement de filtre.
(function () {
  'use strict';

  var WIDGET_BUILD = '2026-09-08-v4';
  console.log('[Tableau de bord] build ' + WIDGET_BUILD);

  var state = {
    reponses: [],
    sites: [],
    services: [],
    formulaires: [],      // [{id, Titre, Table_Technique, Actif}, ...]
    siteLabels: {},
    formulaireLabels: {},
    serviceLabels: {},
    filterSite: null,       // id de site sélectionné, ou null = tous
    filterService: null,    // id de service sélectionné, ou null = tous
    selectedFormulaireId: null, // null = vue générale ("Tous")
    technicalRowsCache: {},  // Table_Technique -> lignes déjà récupérées (rafraîchi au clic "Rafraîchir")
    excludedFields: {}       // Table_Technique -> [colId, ...] à ne pas afficher, réglable via ⚙
  };

  function init() {
    // grist.ready() n'est plus appelé ici : un seul appel global, fait une
    // fois par l'orchestrateur (app-shell.js) pour l'ensemble du widget
    // fusionné, couvre aussi cet écran.

    document.getElementById('d-version-tag').textContent = 'build ' + WIDGET_BUILD;

    loadExcludedFields().then(loadAndRender);

    document.getElementById('d-btn-refresh').addEventListener('click', function () {
      loadAndRender();
    });
    document.getElementById('d-btn-settings').addEventListener('click', openSettingsPanel);
    document.getElementById('d-settings-close').addEventListener('click', closeSettingsPanel);
    document.getElementById('d-settings-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'd-settings-overlay') closeSettingsPanel();
    });
    document.getElementById('d-settings-save').addEventListener('click', saveSettingsPanel);
  }

  // ---------------------------------------------------------------
  // Réglages persistés (quels champs afficher dans les graphiques)
  // ---------------------------------------------------------------
  // Repose sur le stockage d'options natif d'un widget personnalisé
  // Grist (grist.widgetApi.setOption / getOption), qui persiste la
  // valeur avec le document, propre à cet emplacement de widget — pas
  // besoin d'une table Grist dédiée pour ça.
  //
  // Point non vérifié en conditions réelles : le nom exact de ces deux
  // méthodes. Si elles n'existent pas telles quelles, une erreur claire
  // s'affiche en console au lieu d'un échec silencieux, pour repérer
  // vite le nom réel à utiliser.
  function hasWidgetOptionsApi() {
    return !!(global_grist().widgetApi &&
      typeof global_grist().widgetApi.getOption === 'function' &&
      typeof global_grist().widgetApi.setOption === 'function');
  }
  function global_grist() { return window.grist; }

  async function loadExcludedFields() {
    if (!hasWidgetOptionsApi()) {
      console.warn('[Tableau de bord] grist.widgetApi.getOption/setOption introuvable — ' +
        'réglages non persistés pour cette session, valeurs par défaut utilisées.');
      state.excludedFields = DashboardData.DEFAULT_EXCLUDED_FIELDS;
      return;
    }
    try {
      var saved = await grist.widgetApi.getOption('excludedFields');
      console.log('[Tableau de bord] valeur lue via getOption("excludedFields") :', saved);
      state.excludedFields = saved ? JSON.parse(saved) : DashboardData.DEFAULT_EXCLUDED_FIELDS;
    } catch (err) {
      console.error('[Tableau de bord] échec de lecture des réglages, valeurs par défaut utilisées', err);
      state.excludedFields = DashboardData.DEFAULT_EXCLUDED_FIELDS;
    }
  }

  async function saveExcludedFields(map) {
    state.excludedFields = map;
    if (!hasWidgetOptionsApi()) {
      console.warn('[Tableau de bord] réglage non persisté (API indisponible) — valable pour cette session seulement.');
      return;
    }
    try {
      console.log('[Tableau de bord] écriture via setOption("excludedFields") :', JSON.stringify(map));
      await grist.widgetApi.setOption('excludedFields', JSON.stringify(map));
      console.log('[Tableau de bord] setOption terminé sans erreur.');
    } catch (err) {
      console.error('[Tableau de bord] échec de l’enregistrement des réglages', err);
    }
  }

  // ---------------------------------------------------------------
  // Panneau de réglages
  // ---------------------------------------------------------------
  async function openSettingsPanel() {
    var overlay = document.getElementById('d-settings-overlay');
    var body = document.getElementById('d-settings-body');
    overlay.hidden = false;
    body.innerHTML = '<div class="state-screen" style="padding:24px 0;"><div class="spinner"></div>Chargement des champs…</div>';

    var activeForms = state.formulaires.filter(function (f) { return f.Actif && f.Table_Technique; });

    try {
      var perFormulaireFields = await Promise.all(activeForms.map(function (f) {
        return DashboardData.discoverChartableFields(f.Table_Technique);
      }));

      var html = activeForms.map(function (f, idx) {
        var fields = perFormulaireFields[idx];
        var excluded = state.excludedFields[f.Table_Technique] || [];
        if (!fields.length) {
          return '<div class="settings-group"><h3>' + escapeHtml(f.Titre) + '</h3>' +
            '<div class="settings-empty">Aucun champ Choix, Booléen ou Numérique sur ce formulaire.</div></div>';
        }
        var fieldsHtml = fields.map(function (field) {
          var checked = excluded.indexOf(field.key) === -1 ? ' checked' : '';
          var inputId = 'settings-' + f.Table_Technique + '-' + field.key;
          return '<div class="settings-field">' +
            '<input type="checkbox" id="' + inputId + '" data-table="' + escapeHtml(f.Table_Technique) + '" data-field="' + escapeHtml(field.key) + '"' + checked + '>' +
            '<label for="' + inputId + '">' + escapeHtml(field.label) + '</label>' +
          '</div>';
        }).join('');
        return '<div class="settings-group"><h3>' + escapeHtml(f.Titre) + '</h3>' + fieldsHtml + '</div>';
      }).join('');

      body.innerHTML = html || '<div class="settings-empty">Aucun formulaire actif pour le moment.</div>';
    } catch (err) {
      console.error('[Tableau de bord] échec du chargement du panneau de réglages', err);
      body.innerHTML = '<div class="settings-empty">Impossible de charger les champs : ' +
        escapeHtml(err && err.message ? err.message : err) + '</div>';
    }
  }

  function closeSettingsPanel() {
    document.getElementById('d-settings-overlay').hidden = true;
  }

  async function saveSettingsPanel() {
    var map = {};
    document.querySelectorAll('#d-settings-body input[type="checkbox"]').forEach(function (input) {
      var table = input.getAttribute('data-table');
      var field = input.getAttribute('data-field');
      if (!input.checked) {
        map[table] = map[table] || [];
        map[table].push(field);
      }
    });
    await saveExcludedFields(map);
    closeSettingsPanel();
    renderAll();
  }

  async function loadAndRender() {
    try {
      var data = await DashboardData.loadAll();
      state.reponses = data.reponses;
      state.sites = data.sites;
      state.services = data.services;
      state.formulaires = data.formulaires;
      state.siteLabels = data.siteLabels;
      state.formulaireLabels = data.formulaireLabels;
      state.serviceLabels = data.serviceLabels;
      state.technicalRowsCache = {}; // les données ont pu changer, on ne garde pas l'ancien cache

      document.getElementById('d-state-screen').hidden = true;
      document.getElementById('d-dashboard').hidden = false;

      populateSiteFilter();
      populateServiceFilter();
      populateFormTabs();
      renderAll();
    } catch (err) {
      console.error('[Tableau de bord] échec du chargement', err);
      document.getElementById('d-state-screen').textContent =
        'Impossible de charger les données : ' + (err && err.message ? err.message : err);
    }
  }

  // ---------------------------------------------------------------
  // Filtres
  // ---------------------------------------------------------------

  // Sites réellement présents dans les réponses visibles par l'utilisateur
  // (pas la liste complète de la table Sites) — un Manager ne verra donc
  // qu'un seul site dans ce sélecteur, cohérent avec son périmètre.
  function visibleSiteIds() {
    var ids = {};
    state.reponses.forEach(function (r) { if (r.Site) ids[r.Site] = true; });
    return Object.keys(ids).map(Number);
  }

  function visibleServiceIds(forSiteId) {
    var ids = {};
    state.reponses.forEach(function (r) {
      if (!r.Service) return;
      if (forSiteId && r.Site !== forSiteId) return;
      ids[r.Service] = true;
    });
    return Object.keys(ids).map(Number);
  }

  function populateSiteFilter() {
    var select = document.getElementById('d-filter-site');
    var current = state.filterSite;
    select.innerHTML = '<option value="">Tous les sites</option>';
    visibleSiteIds()
      .sort(function (a, b) { return (state.siteLabels[a] || '').localeCompare(state.siteLabels[b] || ''); })
      .forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = state.siteLabels[id] || ('#' + id);
        select.appendChild(opt);
      });
    select.value = current ? String(current) : '';
  }

  function populateServiceFilter() {
    var select = document.getElementById('d-filter-service');
    var current = state.filterService;
    select.innerHTML = '<option value="">Tous les services</option>';
    visibleServiceIds(state.filterSite)
      .sort(function (a, b) { return (state.serviceLabels[a] || '').localeCompare(state.serviceLabels[b] || ''); })
      .forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = state.serviceLabels[id] || ('#' + id);
        select.appendChild(opt);
      });
    // Si le service précédemment sélectionné n'appartient plus au site
    // choisi, on réinitialise plutôt que de garder un filtre incohérent.
    var stillValid = current && visibleServiceIds(state.filterSite).indexOf(current) !== -1;
    state.filterService = stillValid ? current : null;
    select.value = state.filterService ? String(state.filterService) : '';
  }

  function currentFilteredReponses() {
    return state.reponses.filter(function (r) {
      if (state.filterSite && r.Site !== state.filterSite) return false;
      if (state.filterService && r.Service !== state.filterService) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------
  // Onglets "type de formulaire"
  // ---------------------------------------------------------------
  function populateFormTabs() {
    var container = document.getElementById('d-form-tabs');
    var activeForms = state.formulaires.filter(function (f) { return f.Actif; });

    var html = '<button type="button" data-formulaire="" class="' +
      (state.selectedFormulaireId === null ? 'active' : '') + '">Tous</button>';
    activeForms.forEach(function (f) {
      var active = state.selectedFormulaireId === f.id ? ' active' : '';
      html += '<button type="button" data-formulaire="' + f.id + '" class="' + active.trim() + '">' +
        escapeHtml(f.Titre) + '</button>';
    });
    container.innerHTML = html;

    container.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var val = btn.getAttribute('data-formulaire');
        state.selectedFormulaireId = val ? Number(val) : null;
        populateFormTabs(); // pour mettre à jour la classe "active"
        renderAll();
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bindFilterEvents() {
    document.getElementById('d-filter-site').addEventListener('change', function (e) {
      state.filterSite = e.target.value ? Number(e.target.value) : null;
      state.filterService = null; // le site change : le service redevient "Tous"
      populateServiceFilter();
      renderAll();
    });

    document.getElementById('d-filter-service').addEventListener('change', function (e) {
      state.filterService = e.target.value ? Number(e.target.value) : null;
      renderAll();
    });

    document.getElementById('d-filter-reset').addEventListener('click', function () {
      state.filterSite = null;
      state.filterService = null;
      populateSiteFilter();
      populateServiceFilter();
      renderAll();
    });
  }

  // ---------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------
  function renderAll() {
    var filtered = currentFilteredReponses();

    document.getElementById('d-filter-count').textContent =
      filtered.length + ' intervention' + (filtered.length > 1 ? 's' : '');

    var generalEl = document.getElementById('d-charts-general');
    var formulaireEl = document.getElementById('d-charts-formulaire');

    if (state.selectedFormulaireId === null) {
      generalEl.hidden = false;
      formulaireEl.hidden = true;
      renderGeneralCharts(filtered);
    } else {
      generalEl.hidden = true;
      formulaireEl.hidden = false;
      renderFormulaireCharts(state.selectedFormulaireId, filtered).catch(function (err) {
        console.error('[Tableau de bord] échec du rendu par formulaire', err);
        formulaireEl.innerHTML = '<div class="chart-card"><div class="chart-empty" style="position:static;">' +
          'Impossible d’afficher ce formulaire : ' + escapeHtml(err && err.message ? err.message : err) +
          '</div></div>';
      });
    }
  }

  function renderGeneralCharts(filtered) {
    renderOneChart('d-chart-formulaire', 'd-empty-formulaire',
      DashboardData.countBy(filtered, 'Formulaire', state.formulaireLabels));

    renderOneChart('d-chart-site', 'd-empty-site',
      DashboardData.countBy(filtered, 'Site', state.siteLabels));

    renderOneChart('d-chart-service', 'd-empty-service',
      DashboardData.countBy(filtered, 'Service', state.serviceLabels));
  }

  // Récupère (avec cache) les lignes de la table technique d'un
  // formulaire, puis ne garde que celles dont la Reponse liée fait
  // partie des réponses actuellement filtrées (Site / Service / ce
  // formulaire) — c'est ce qui permet aux filtres Site/Service de
  // continuer à s'appliquer même en vue "par formulaire".
  async function renderFormulaireCharts(formulaireId, filteredReponses) {
    var formulaire = state.formulaires.filter(function (f) { return f.id === formulaireId; })[0];
    if (!formulaire || !formulaire.Table_Technique) {
      document.getElementById('d-charts-formulaire').innerHTML =
        '<div class="chart-card">Ce formulaire n’a pas de table technique configurée.</div>';
      return;
    }
    var tableId = formulaire.Table_Technique;

    var allowedReponseIds = {};
    filteredReponses.forEach(function (r) {
      if (r.Formulaire === formulaireId) allowedReponseIds[r.id] = true;
    });

    document.getElementById('d-charts-formulaire').innerHTML =
      '<div class="chart-card"><div class="state-screen" style="padding:24px 0;">' +
      '<div class="spinner"></div>Chargement des champs du formulaire…</div></div>';

    var fields = await DashboardData.discoverChartableFields(tableId);
    var excluded = state.excludedFields[tableId] || [];
    fields = fields.filter(function (f) { return excluded.indexOf(f.key) === -1; });

    if (!state.technicalRowsCache[tableId]) {
      var raw = await grist.docApi.fetchTable(tableId);
      state.technicalRowsCache[tableId] = DashboardData.toRows(raw);
    }
    var technicalRows = state.technicalRowsCache[tableId].filter(function (row) {
      return allowedReponseIds[row.Reponse];
    });

    if (!fields.length) {
      document.getElementById('d-charts-formulaire').innerHTML =
        '<div class="chart-card">Aucun champ à afficher (type non pris en charge, ou tous les champs sont exclus dans les réglages ⚙).</div>';
      return;
    }

    var html = fields.map(function (f) {
      var canvasId = 'chart-field-' + f.key;
      if (f.kind === 'number') {
        return '<div class="chart-card"><h2>' + escapeHtml(f.label) + ' (moyenne)</h2>' +
          '<div class="stat-card" id="stat-' + f.key + '"></div></div>';
      }
      return '<div class="chart-card"><h2>' + escapeHtml(f.label) + '</h2>' +
        '<div class="chart-wrap"><canvas id="' + canvasId + '"></canvas></div>' +
        '<div class="chart-empty" id="empty-field-' + f.key + '" hidden>Aucune donnée pour cette sélection</div></div>';
    }).join('');
    document.getElementById('d-charts-formulaire').innerHTML = html;

    fields.forEach(function (f) {
      if (f.kind === 'number') {
        var avg = DashboardData.averageOf(technicalRows, f.key);
        var statEl = document.getElementById('stat-' + f.key);
        statEl.innerHTML = (avg === null)
          ? '<div class="stat-sub">Aucune donnée pour cette sélection</div>'
          : '<div class="stat-value">' + avg.toFixed(2) + '</div><div class="stat-sub">' +
            technicalRows.length + ' valeur' + (technicalRows.length > 1 ? 's' : '') + '</div>';
      } else {
        renderOneChart('chart-field-' + f.key, 'empty-field-' + f.key,
          DashboardData.countByRaw(technicalRows, f.key));
      }
    });
  }

  function renderOneChart(canvasId, emptyId, data) {
    var emptyEl = document.getElementById(emptyId);
    var canvas = document.getElementById(canvasId);
    if (data.length) {
      emptyEl.hidden = true;
      canvas.hidden = false;
      DashboardCharts.renderBarChart(canvasId, data);
    } else {
      emptyEl.hidden = false;
      canvas.hidden = true;
    }
  }

  bindFilterEvents();

  // Exposé pour l'orchestrateur (app-shell.js), qui appelle .init() au
  // moment choisi plutôt qu'automatiquement au chargement du fichier —
  // nécessaire puisque ce script coexiste maintenant avec 2 autres
  // écrans sur la même page.
  window.DashboardApp = { init: init };
})();
