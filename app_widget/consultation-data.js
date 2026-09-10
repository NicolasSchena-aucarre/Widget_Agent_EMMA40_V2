// data.js
// Récupération des données et découverte dynamique des champs à afficher
// en lecture seule pour une Réponse donnée. Même principe de découverte
// que dans les widgets Formulaire terrain / Tableau de bord : voir
// Widgets_Dynamiques_Grist_Reference.md pour le détail de la technique.
(function (global) {
  'use strict';

  function toRows(table) {
    var keys = Object.keys(table).filter(function (k) { return k !== 'tableId'; });
    var n = table.id.length;
    var rows = [];
    for (var i = 0; i < n; i++) {
      var row = {};
      for (var j = 0; j < keys.length; j++) row[keys[j]] = table[keys[j]][i];
      rows.push(row);
    }
    return rows;
  }

  function buildLookup(rows, field) {
    var map = {};
    rows.forEach(function (r) { map[r.id] = r[field]; });
    return map;
  }

  function toList(v) {
    if (Array.isArray(v) && v[0] === 'L') return v.slice(1);
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined) return [];
    return [v];
  }

  // Charge tout ce qu'il faut pour la liste et les libellés d'en-tête.
  // fetchTable respecte déjà les règles d'accès : la liste de Reponses
  // reçue ici est déjà limitée au périmètre du rôle connecté.
  async function loadAll() {
    var results = await Promise.all([
      grist.docApi.fetchTable('Reponses'),
      grist.docApi.fetchTable('Formulaires'),
      grist.docApi.fetchTable('Agents'),
      grist.docApi.fetchTable('Sites'),
      grist.docApi.fetchTable('Services')
    ]);

    var reponses = toRows(results[0]);
    var formulaires = toRows(results[1]);
    var agents = toRows(results[2]);
    var sites = toRows(results[3]);
    var services = toRows(results[4]);

    return {
      reponses: reponses,
      formulaires: formulaires,
      formulaireLabels: buildLookup(formulaires, 'Titre'),
      agentLabels: buildLookup(agents, 'Nom_Complet_Agent'),
      siteLabels: buildLookup(sites, 'Nom'),
      serviceLabels: (function () {
        var siteLabels = buildLookup(sites, 'Nom');
        var map = {};
        services.forEach(function (s) {
          var siteName = siteLabels[s.Site] || '';
          map[s.id] = s.Type + (siteName ? ' (' + siteName + ')' : '');
        });
        return map;
      })()
    };
  }

  // ---------------------------------------------------------------
  // Découverte dynamique des champs à afficher pour une table technique
  // ---------------------------------------------------------------
  // Contrairement aux widgets Formulaire (quel champ de saisie afficher)
  // et Tableau de bord (quel champ est "agrégeable"), on veut ici
  // afficher TOUTES les colonnes de données, y compris Texte et Pièce
  // jointe, puisque le but est de restituer fidèlement ce qui a été
  // saisi — rien à ignorer sauf les colonnes techniques et la référence
  // vers Reponses elle-même.
  var GRIST_KIND_MAP = {
    'Bool': 'bool',
    'Numeric': 'number',
    'Int': 'number',
    'Date': 'date',
    'DateTime': 'date',
    'Attachments': 'attachment',
    'Choice': 'text',
    'Text': 'text'
  };

  var fieldsCache = {};

  function humanizeLabel(colId) {
    return colId.replace(/_/g, ' ');
  }

  async function discoverDisplayFields(tableId) {
    if (fieldsCache[tableId]) return fieldsCache[tableId];

    var tablesMeta = await grist.docApi.fetchTable('_grist_Tables');
    var idx = tablesMeta.tableId.indexOf(tableId);
    if (idx === -1) {
      throw new Error('Table technique introuvable dans les métadonnées : ' + tableId);
    }
    var internalTableId = tablesMeta.id[idx];

    var colsMeta = await grist.docApi.fetchTable('_grist_Tables_column');
    var fields = [];

    for (var i = 0; i < colsMeta.id.length; i++) {
      if (colsMeta.parentId[i] !== internalTableId) continue;

      var colId = colsMeta.colId[i];
      var type = colsMeta.type[i];
      var isFormula = colsMeta.isFormula[i];

      if (isFormula) continue;
      if (colId === 'manualSort' || colId === 'id' || colId === 'Reponse') continue;
      if (type && type.indexOf('Ref:') === 0) continue;

      fields.push({
        key: colId,
        label: humanizeLabel(colId),
        kind: GRIST_KIND_MAP[type] || 'text'
      });
    }

    // Adresse toujours en premier, par cohérence avec les autres widgets.
    fields.sort(function (a, b) {
      return (a.key === 'Adresse' ? 0 : 1) - (b.key === 'Adresse' ? 0 : 1);
    });

    fieldsCache[tableId] = fields;
    return fields;
  }

  // Récupère la ligne technique correspondant à une Reponse donnée.
  // (Pas de mise en cache ici : la table entière est relativement petite
  // et on préfère des données fraîches à chaque sélection.)
  async function fetchTechnicalRow(tableId, reponseId) {
    var raw = await grist.docApi.fetchTable(tableId);
    var rows = toRows(raw);
    return rows.filter(function (r) { return r.Reponse === reponseId; })[0] || null;
  }

  // ---------------------------------------------------------------
  // Géocodage d'adresse (API Adresse / BAN, adresse.data.gouv.fr) —
  // même service public que celui utilisé pour l'autocomplétion dans le
  // widget Formulaire terrain, ici en mode "recherche" plutôt que
  // "suggestions au fil de la frappe".
  // ---------------------------------------------------------------
  var geocodeCache = {};

  async function geocodeAddress(address) {
    if (!address) return null;
    if (geocodeCache[address] !== undefined) return geocodeCache[address];

    try {
      var url = 'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(address) + '&limit=1';
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var feature = data.features && data.features[0];
      var result = feature
        ? { lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0], label: feature.properties.label }
        : null;
      geocodeCache[address] = result;
      return result;
    } catch (err) {
      console.error('[Consultation] échec du géocodage', err);
      geocodeCache[address] = null;
      return null;
    }
  }

  global.ConsultationData = {
    toRows: toRows,
    buildLookup: buildLookup,
    toList: toList,
    loadAll: loadAll,
    discoverDisplayFields: discoverDisplayFields,
    fetchTechnicalRow: fetchTechnicalRow,
    geocodeAddress: geocodeAddress
  };
})(window);
