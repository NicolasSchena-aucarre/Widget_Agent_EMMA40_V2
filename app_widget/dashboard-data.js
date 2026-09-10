// data.js
// Récupération des tables Grist et mise en forme en tableaux de lignes /
// dictionnaires de correspondance (id -> libellé), pour que app.js et
// charts.js n'aient jamais à connaître le format "colonnes" renvoyé par
// grist.docApi.fetchTable.
(function (global) {
  'use strict';

  // Convertit une table au format "colonnes" (celui renvoyé par
  // fetchTable : {id:[...], ColA:[...], ColB:[...]}) en tableau de lignes
  // [{id, ColA, ColB}, ...], plus pratique à manipuler.
  function toRows(table) {
    var keys = Object.keys(table).filter(function (k) { return k !== 'tableId'; });
    var n = table.id.length;
    var rows = [];
    for (var i = 0; i < n; i++) {
      var row = {};
      for (var j = 0; j < keys.length; j++) {
        row[keys[j]] = table[keys[j]][i];
      }
      rows.push(row);
    }
    return rows;
  }

  // Construit un dictionnaire id -> valeur d'un champ, pour retrouver
  // rapidement un libellé à partir d'une référence.
  function buildLookup(rows, field) {
    var map = {};
    rows.forEach(function (r) { map[r.id] = r[field]; });
    return map;
  }

  // Charge les 4 tables nécessaires au tableau de bord. Ce que
  // fetchTable renvoie respecte déjà les règles d'accès du document :
  // un Manager ne recevra que les lignes de Reponses de son propre
  // service, etc. — le widget n'a donc rien à filtrer lui-même pour la
  // sécurité, seulement pour l'interactivité (les sélecteurs).
  async function loadAll() {
    var results = await Promise.all([
      grist.docApi.fetchTable('Reponses'),
      grist.docApi.fetchTable('Formulaires'),
      grist.docApi.fetchTable('Sites'),
      grist.docApi.fetchTable('Services')
    ]);

    var reponses = toRows(results[0]);
    var formulaires = toRows(results[1]);
    var sites = toRows(results[2]);
    var services = toRows(results[3]);

    var siteLabels = buildLookup(sites, 'Nom');
    var formulaireLabels = buildLookup(formulaires, 'Titre');

    // Le libellé d'un service inclut le nom du site, pour lever
    // l'ambiguïté entre deux services de même type sur des sites
    // différents (ex. "Distribution" à Site Nord et à Site Sud).
    var serviceLabels = {};
    services.forEach(function (s) {
      var siteName = siteLabels[s.Site] || '';
      serviceLabels[s.id] = s.Type + (siteName ? ' (' + siteName + ')' : '');
    });

    return {
      reponses: reponses,
      formulaires: formulaires,
      sites: sites,
      services: services,
      siteLabels: siteLabels,
      formulaireLabels: formulaireLabels,
      serviceLabels: serviceLabels
    };
  }

  // Compte les lignes de `rows` groupées par la valeur du champ `field`,
  // en traduisant chaque id via `labels`. Retourne un tableau trié par
  // effectif décroissant : [{id, label, count}, ...].
  function countBy(rows, field, labels) {
    var counts = {};
    rows.forEach(function (r) {
      var key = r[field];
      if (key === null || key === undefined || key === 0) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (key) {
        var id = Number(key);
        return { id: id, label: labels[id] || ('#' + id), count: counts[key] };
      })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // Variante de countBy pour une valeur "brute" (pas une référence à
  // traduire via un dictionnaire) : une chaîne de Choix, ou un booléen.
  // Utilisée pour les champs propres à un formulaire (ex. "Gravité").
  function countByRaw(rows, field) {
    var counts = {};
    rows.forEach(function (r) {
      var val = r[field];
      if (val === null || val === undefined || val === '') return;
      var key = (typeof val === 'boolean') ? (val ? 'Oui' : 'Non') : String(val);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (label) { return { label: label, count: counts[label] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // Moyenne d'un champ numérique, en ignorant les valeurs absentes.
  // Retourne null si aucune valeur exploitable.
  function averageOf(rows, field) {
    var values = rows
      .map(function (r) { return r[field]; })
      .filter(function (v) { return typeof v === 'number' && !isNaN(v); });
    if (!values.length) return null;
    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    return sum / values.length;
  }

  // ---------------------------------------------------------------
  // Découverte dynamique des champs "intéressants à visualiser" d'une
  // table technique (Releve_de_compteur, Signalement_de_fuite, etc.),
  // à partir des tables de métadonnées internes de Grist. Même principe
  // que dans le widget "Formulaire terrain" : ajouter une colonne dans
  // Grist suffit à la faire apparaître ici, sans toucher au code.
  //
  // Seuls les types directement "comptables" sont retenus : Choix (une
  // barre par option), Booléen (Oui/Non), Numérique (moyenne affichée en
  // carte). Les colonnes Texte, Pièce jointe, Date et Référence ne sont
  // pas assez "agrégeables" pour un graphique générique et sont ignorées.
  //
  // Point non vérifié en conditions réelles, comme pour le widget
  // Formulaire : la lecture de _grist_Tables / _grist_Tables_column par
  // un compte non-Propriétaire.
  // Certains champs n'ont pas d'intérêt à être visualisés (une moyenne
  // sans sens métier, un champ trop spécifique...). Ce n'est pas quelque
  // chose que la structure Grist seule permet de déduire — c'est un
  // réglage propre à chaque document, modifiable depuis le widget via le
  // bouton ⚙ (voir app.js), et persisté avec grist.widgetApi.setOption.
  // Cette liste ne sert plus que de valeur de départ, utilisée une seule
  // fois si aucun réglage n'a encore été enregistré.
  var DEFAULT_EXCLUDED_FIELDS = {
    'Releve_de_compteur': ['Index_Releve'],
    'Signalement_de_fuite': ['Diametre_Canalisation']
  };

  var chartableFieldsCache = {};

  function humanizeLabel(colId) {
    return colId.replace(/_/g, ' ');
  }

  function parseWidgetOptionsJson(raw) {
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  // Renvoie TOUS les champs "agrégeables" (Choix, Booléen, Numérique)
  // d'une table technique, sans appliquer aucune exclusion — le tri
  // "afficher / ne pas afficher" se fait au moment du rendu (app.js), à
  // partir des réglages enregistrés, pour qu'un changement de réglage
  // n'ait pas besoin d'invalider ce cache.
  async function discoverChartableFields(tableId) {
    if (chartableFieldsCache[tableId]) return chartableFieldsCache[tableId];

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

      if (type === 'Choice') {
        var opts = parseWidgetOptionsJson(colsMeta.widgetOptions[i]);
        fields.push({
          key: colId,
          label: humanizeLabel(colId),
          kind: 'choice',
          options: (opts && opts.choices) ? opts.choices : []
        });
      } else if (type === 'Bool') {
        fields.push({ key: colId, label: humanizeLabel(colId), kind: 'bool' });
      } else if (type === 'Numeric' || type === 'Int') {
        fields.push({ key: colId, label: humanizeLabel(colId), kind: 'number' });
      }
      // Text, Date, Attachments, Ref:* : pas assez "agrégeables" pour un
      // graphique générique, volontairement ignorés ici.
    }

    chartableFieldsCache[tableId] = fields;
    return fields;
  }

  global.DashboardData = {
    toRows: toRows,
    buildLookup: buildLookup,
    loadAll: loadAll,
    countBy: countBy,
    countByRaw: countByRaw,
    averageOf: averageOf,
    discoverChartableFields: discoverChartableFields,
    DEFAULT_EXCLUDED_FIELDS: DEFAULT_EXCLUDED_FIELDS
  };
})(window);
