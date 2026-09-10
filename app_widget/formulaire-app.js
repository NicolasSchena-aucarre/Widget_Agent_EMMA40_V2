// formulaire-app.js — fusion de grist-api.js, schema.js, data.js, address.js, ui.js, app.js
// Enveloppé dans sa propre portée pour ne pas fuiter dans l'espace global
// partagé avec les écrans Tableau de bord et Consultation (voir app-shell.js).
(function () {
"use strict";

// ===== grist-api.js =====
// grist-api.js
// Utilitaires génériques (listes Grist, dates) et communication avec
// l'API REST de Grist via jeton d'accès (upload de pièces jointes,
// écriture d'actions via /apply). Voir API_Grist_Widget_Reference.md pour
// le détail de chaque contournement de bug documenté ici.

"use strict";
  function toList(v){
    if (Array.isArray(v) && v[0] === 'L') return v.slice(1);
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined) return [];
    return [v];
  }

  function todayStr(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function dateStrToEpoch(s){
    if (!s) return null;
    return Math.floor(new Date(s + 'T12:00:00Z').getTime()/1000);
  }

  // grist.docApi.uploadAttachment n'existe pas dans toutes les versions de
  // l'API des widgets. On passe donc par l'API REST du document via un
  // jeton d'accès temporaire (grist.docApi.getAccessToken), ce qui est
  // la méthode plus largement disponible. Chaque échec est isolé : une
  // pièce jointe qui ne s'envoie pas n'empêche pas le reste d'être
  // enregistré.
  // Le docId "court" utilisé dans l'URL du document (ex. f99r74L5RvXs) est
  // différent de l'id canonique interne encodé dans le jeton d'accès (ex.
  // f99r74L5RvXsoLcEZcY1BR) — voir grist-shared.js (chargé avant ce
  // fichier) pour decodeJwtDocId / buildApiBase, qui corrigent ça.

  function buildAttachmentsUrl(tokenInfo){
    return buildApiBase(tokenInfo) + '/attachments?auth=' + encodeURIComponent(tokenInfo.token);
  }

  // Envoie un lot d'actions (même format que grist.docApi.applyUserActions)
  // via l'API REST/jeton, plutôt que via le canal WebSocket habituel. Sert
  // à garder la même identité "côté jeton" que l'upload de pièce jointe,
  // au cas où le serveur distinguerait les deux canaux (hypothèse en cours
  // de vérification sur l'instance self-hosted).
  async function applyActionsViaRest(tokenInfo, actions){
    var url = buildApiBase(tokenInfo) + '/apply?auth=' + encodeURIComponent(tokenInfo.token);
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actions)
    });
    if (!res.ok){
      var bodyText = '';
      try { bodyText = await res.text(); } catch(e){}
      throw new Error('HTTP ' + res.status + (bodyText ? ' — ' + bodyText.slice(0,300) : ''));
    }
    var data = await res.json();
    console.log('[Formulaire terrain] réponse /apply', data);
    // Le format exact de la réponse de /apply n'est pas garanti identique à
    // celui de applyUserActions ; on gère les deux formes plausibles.
    return (data && data.retValues) ? data.retValues : data;
  }

  // Grist exige, pour toute requête POST, l'un de ces deux en-têtes comme
  // protection anti-CSRF : Content-Type: application/json OU
  // X-Requested-With: XMLHttpRequest. Un fetch() avec FormData ne pose
  // aucun des deux par défaut (Content-Type devient multipart/form-data),
  // donc la requête était traitée comme "non authentifiée" avant même de
  // vérifier le jeton — d'où le 401, qui remontait ensuite comme une
  // fausse erreur CORS côté navigateur (la réponse d'erreur de Grist ne
  // porte pas d'en-tête CORS).
  async function uploadAttachmentViaRest(file, tokenInfo){
    var url = buildAttachmentsUrl(tokenInfo);
    console.log('[Formulaire terrain] upload vers ' + url.split('?')[0] + ' (voir onglet Réseau pour le détail)');
    var formData = new FormData();
    formData.append('upload', file, file.name);
    var res;
    try {
      res = await fetch(url, {
        method:'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: formData
      });
    } catch (networkErr) {
      throw new Error('Requête bloquée avant même d’atteindre le serveur (probable CORS) — cible : ' + url.split('?')[0]);
    }
    if (!res.ok){
      var bodyText = '';
      try { bodyText = await res.text(); } catch(e){}
      throw new Error('HTTP ' + res.status + (bodyText ? ' — ' + bodyText.slice(0,200) : ''));
    }
    var data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  }

// ===== schema.js =====
// schema.js
// Découverte dynamique des champs d'un formulaire à partir des tables de
// métadonnées internes de Grist (_grist_Tables, _grist_Tables_column).
// Ajouter une colonne à une table technique dans Grist suffit à la faire
// apparaître ici, sans modification de ce fichier.

"use strict";
  // ---------------------------------------------------------------
  // Découverte dynamique des champs d'un formulaire
  // ---------------------------------------------------------------
  // Plutôt qu'une liste de champs codée en dur par table technique, on
  // interroge les tables de métadonnées internes de Grist
  // (_grist_Tables, _grist_Tables_column) pour découvrir automatiquement
  // les colonnes d'une table technique, leur type, et — pour les colonnes
  // de type Choix — leurs options. Ajouter une colonne à une table
  // technique dans Grist suffit alors à la faire apparaître dans le
  // widget, sans modification ni redéploiement de ce fichier.
  //
  // Limite connue et assumée : seul le type Grist générique est détecté
  // (Texte, Numérique, Booléen, Date, Choix, Pièce jointe). Les
  // comportements spécifiques qu'avaient les anciens formulaires codés en
  // dur (autocomplétion d'adresse, unité affichée à côté d'un nombre,
  // mise en forme "urgent") ne peuvent pas être devinés à partir du seul
  // type de colonne — seule l'exception "Adresse" (nom de colonne exact)
  // est reconnue automatiquement, car cette convention de nommage est
  // déjà utilisée dans toutes les tables techniques existantes.
  //
  // Point non vérifié en conditions réelles : la lecture de
  // _grist_Tables / _grist_Tables_column par un compte non-Propriétaire.
  // Les tables de métadonnées sont généralement lisibles par quiconque a
  // accès au document (c'est ce qui permet à Grist d'afficher les en-têtes
  // de colonnes à un Éditeur), mais ce point mérite d'être testé
  // spécifiquement avec chaque rôle avant mise en production.
  var GRIST_TYPE_MAP = {
    'Bool': 'bool',
    'Numeric': 'number',
    'Int': 'number',
    'Date': 'date',
    'DateTime': 'date',
    'Attachments': 'attachment',
    'Text': 'text'
  };

  var schemaCache = {}; // tableId technique -> tableau de champs déjà découverts

  function humanizeLabel(colId){
    return colId.replace(/_/g, ' ');
  }

  function parseWidgetOptionsJson(raw){
    try { return raw ? JSON.parse(raw) : null; } catch (e){ return null; }
  }

  async function discoverFieldSchema(tableId){
    if (schemaCache[tableId]) return schemaCache[tableId];

    var tablesMeta = await grist.docApi.fetchTable('_grist_Tables');
    var idx = tablesMeta.tableId.indexOf(tableId);
    if (idx === -1){
      throw new Error('Table technique introuvable dans les métadonnées : ' + tableId);
    }
    var internalTableId = tablesMeta.id[idx];

    var colsMeta = await grist.docApi.fetchTable('_grist_Tables_column');
    var fields = [];

    for (var i = 0; i < colsMeta.id.length; i++){
      if (colsMeta.parentId[i] !== internalTableId) continue;

      var colId = colsMeta.colId[i];
      var type = colsMeta.type[i];
      var isFormula = colsMeta.isFormula[i];

      // On ignore : les colonnes calculées (formules), le tri interne,
      // l'id, et la colonne Reponse (gérée séparément par le widget, pas
      // affichée comme un champ à remplir).
      if (isFormula) continue;
      if (colId === 'manualSort' || colId === 'id' || colId === 'Reponse') continue;
      if (type && type.indexOf('Ref:') === 0) continue; // autres références, non gérées ici

      var field = { key: colId, label: humanizeLabel(colId) };

      if (colId === 'Adresse' && type === 'Text'){
        field.type = 'address';
        field.required = true;
        field.placeholder = 'Commencez à taper une adresse…';
      } else if (type === 'Choice'){
        field.type = 'choice';
        var opts = parseWidgetOptionsJson(colsMeta.widgetOptions[i]);
        field.options = (opts && opts.choices) ? opts.choices : [];
      } else if (GRIST_TYPE_MAP[type]){
        field.type = GRIST_TYPE_MAP[type];
        if (field.type === 'number') field.step = '0.01';
      } else {
        // Type non géré explicitement (ex. ChoiceList) : repli en texte
        // libre plutôt que de faire disparaître le champ.
        field.type = 'text';
      }

      fields.push(field);
    }

    // L'adresse doit toujours être le premier champ du formulaire, quel
    // que soit l'ordre réel des colonnes dans la table Grist — cet ordre
    // dépend de l'historique de création des colonnes, pas d'un choix
    // volontaire, donc il n'est pas fiable à lui seul pour ce champ-là.
    fields.sort(function (a, b) {
      var aFirst = a.type === 'address' ? 0 : 1;
      var bFirst = b.type === 'address' ? 0 : 1;
      return aFirst - bFirst;
    });

    schemaCache[tableId] = fields;
    return fields;
  }

  // Déclenche la découverte des champs pour une table technique si ce
  // n'est pas déjà fait ou en cours, et redessine le widget une fois le
  // résultat disponible.
  function ensureFieldsLoaded(tableId){
    if (!tableId || schemaCache[tableId] || state.fieldsLoading[tableId]) return;
    state.fieldsLoading[tableId] = true;
    discoverFieldSchema(tableId)
      .then(function(){
        state.fieldsLoading[tableId] = false;
        render();
      })
      .catch(function(err){
        state.fieldsLoading[tableId] = false;
        console.error('[Formulaire terrain] échec de la découverte des champs pour ' + tableId, err);
        schemaCache[tableId] = []; // évite de reboucler indéfiniment
        render();
      });
  }

// ===== data.js =====
// data.js
// Chargement des tables Agents et Formulaires, et détection automatique
// de l'agent connecté (repose sur les Règles d'accès du document, qui
// restreignent la table Agents à sa seule ligne).

"use strict";
  // ---------------------------------------------------------------
  // Chargement des données
  // ---------------------------------------------------------------
  async function loadData(){
    var agentsTable = await grist.docApi.fetchTable('Agents');
    var formulairesTable = await grist.docApi.fetchTable('Formulaires');

    state.agentsRaw = agentsTable;

    formulairesTable.id.forEach(function(id, i){
      state.formulaires[id] = {
        titre: formulairesTable.Titre[i],
        table: formulairesTable.Table_Technique[i],
        actif: formulairesTable.Actif[i],
        // Colonne facultative : si elle n'existe pas encore sur la table
        // Formulaires (ancien document, ou pas encore configurée), on
        // retombe sur une icône générique plutôt que de faire planter le
        // widget.
        icone: (formulairesTable.Icone && formulairesTable.Icone[i]) || '📄',
        servicesConcernes: toList(formulairesTable.Service_Concerne[i])
      };
    });

    // Pas de colonne "qui suis-je" : on s'appuie sur les Règles d'accès du
    // document, qui restreignent la table Agents à la seule ligne de
    // l'utilisateur connecté (voir instructions de configuration). Si la
    // restriction est bien en place, on ne reçoit qu'une seule ligne.
    if (agentsTable.id.length === 1) {
      applyAgentFromRow(0);
    } else {
      // 0 ligne : l'agent connecté n'a pas de ligne correspondante (ou la
      // règle d'accès n'est pas configurée). Plusieurs lignes : compte
      // propriétaire/administrateur qui voit tout, ou règle absente.
      // Dans les deux cas, on retombe sur la sélection manuelle.
      state.manualMode = true;
    }
  }

  function applyAgentFromRow(idx){
    var t = state.agentsRaw;
    var agentServiceId = t.Service ? t.Service[idx] : null;

    // Un formulaire est accessible à l'agent si soit il est listé
    // individuellement dans Agents.Formulaires_Accessibles, soit le
    // service de l'agent fait partie des services concernés par ce
    // formulaire (Formulaires.Service_Concerne) — les deux mécanismes
    // se cumulent, pas besoin de choisir l'un ou l'autre par agent.
    var individualIds = toList(t.Formulaires_Accessibles[idx]);
    var serviceWideIds = Object.keys(state.formulaires)
      .map(Number)
      .filter(function(fid){
        var f = state.formulaires[fid];
        return agentServiceId != null && f.servicesConcernes.indexOf(agentServiceId) !== -1;
      });
    var formIds = individualIds.slice();
    serviceWideIds.forEach(function(fid){
      if (formIds.indexOf(fid) === -1) formIds.push(fid);
    });

    var forms = formIds
      .map(function(id){ return Object.assign({id:id}, state.formulaires[id] || {}); })
      .filter(function(f){ return f.titre && f.actif; });

    state.agent = {
      id: t.id[idx],
      nom: t.Nom_Complet_Agent[idx],
      site: t.gristHelper_Display2 ? t.gristHelper_Display2[idx] : '',
      service: t.gristHelper_Display3 ? t.gristHelper_Display3[idx] : ''
    };
    state.formulairesAgent = forms;
    state.selectedFormulaireId = forms.length ? forms[0].id : null;
  }

// ===== address.js =====
// address.js
// Autocomplétion d'adresse via l'API Adresse (Base Adresse Nationale,
// adresse.data.gouv.fr) — publique, gratuite, sans clé.

"use strict";
  // ---------------------------------------------------------------
  // Autocomplétion d'adresse via l'API Adresse (Base Adresse Nationale,
  // adresse.data.gouv.fr) — publique, gratuite, sans clé. On ne branche
  // que la recherche/suggestion pour l'instant ; le champ reste un texte
  // libre en base (colonne Adresse), donc pas de migration de schéma
  // nécessaire pour bénéficier de la fiabilisation de la saisie.
  // ---------------------------------------------------------------
  var BAN_URL = 'https://api-adresse.data.gouv.fr/search/';
  var addressState = {}; // id -> { timer, controller, results, highlighted }

  function debounce(fn, delay){
    var t;
    return function(){
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(null, args); }, delay);
    };
  }

  async function fetchBanSuggestions(query){
    var url = BAN_URL + '?q=' + encodeURIComponent(query) + '&limit=5&autocomplete=1';
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return (data.features || []).map(function(feat){
      return {
        label: feat.properties.label,
        context: feat.properties.context,
        score: feat.properties.score
      };
    });
  }

  function bindAddressField(id){
    var input = document.getElementById(id);
    var box = document.getElementById('sugg-' + id);
    var status = document.getElementById('status-' + id);
    if (!input || !box) return;
    addressState[id] = { results: [], highlighted: -1 };

    function closeBox(){
      box.classList.remove('open');
      box.innerHTML = '';
      addressState[id].results = [];
      addressState[id].highlighted = -1;
    }

    function renderSuggestions(){
      var st = addressState[id];
      if (!st.results.length){
        box.innerHTML = '<div class="sugg-empty">Aucune adresse trouvée</div>';
        box.classList.add('open');
        return;
      }
      box.innerHTML = st.results.map(function(r, i){
        var cls = 'sugg-item' + (i === st.highlighted ? ' highlighted' : '');
        return '<div class="' + cls + '" data-idx="' + i + '">' + escapeHtml(r.label) +
          (r.context ? ' <span style="color:var(--muted);">— ' + escapeHtml(r.context) + '</span>' : '') +
        '</div>';
      }).join('');
      box.classList.add('open');
      box.querySelectorAll('.sugg-item').forEach(function(el){
        el.addEventListener('mousedown', function(e){
          e.preventDefault(); // évite le blur avant le clic
          var idx = Number(el.getAttribute('data-idx'));
          selectSuggestion(idx);
        });
      });
    }

    function selectSuggestion(idx){
      var st = addressState[id];
      var r = st.results[idx];
      if (!r) return;
      input.value = r.label;
      closeBox();
      if (status) status.textContent = 'Adresse vérifiée (BAN)';
    }

    var doSearch = debounce(function(query){
      if (!query || query.length < 3){
        closeBox();
        if (status) status.textContent = '';
        return;
      }
      if (status) status.textContent = 'Recherche…';
      fetchBanSuggestions(query).then(function(results){
        addressState[id].results = results;
        addressState[id].highlighted = -1;
        renderSuggestions();
        if (status) status.textContent = results.length ? '' : 'Aucune correspondance — vous pouvez saisir librement';
      }).catch(function(err){
        console.error('Recherche adresse BAN échouée', err);
        if (status) status.textContent = 'Recherche indisponible — saisie libre';
        closeBox();
      });
    }, 300);

    input.addEventListener('input', function(){
      if (status) status.textContent = '';
      doSearch(input.value.trim());
    });

    input.addEventListener('keydown', function(e){
      var st = addressState[id];
      if (!st.results.length) return;
      if (e.key === 'ArrowDown'){
        e.preventDefault();
        st.highlighted = Math.min(st.highlighted + 1, st.results.length - 1);
        renderSuggestions();
      } else if (e.key === 'ArrowUp'){
        e.preventDefault();
        st.highlighted = Math.max(st.highlighted - 1, 0);
        renderSuggestions();
      } else if (e.key === 'Enter'){
        if (st.highlighted >= 0){
          e.preventDefault();
          selectSuggestion(st.highlighted);
        }
      } else if (e.key === 'Escape'){
        closeBox();
      }
    });

    input.addEventListener('blur', function(){
      setTimeout(closeBox, 100);
    });
  }


// ===== ui.js =====
// ui.js
// Rendu de l'interface (état, formulaire dynamique, sélecteur manuel) et
// liaison des événements DOM. Ne contient aucun appel réseau direct.

"use strict";
  // ---------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------
  function render(){
    if (state.loading){
      app.innerHTML = '<div class="state-screen"><div class="spinner"></div>Chargement du formulaire…</div>';
      return;
    }
    if (state.error){
      app.innerHTML = '<div class="state-screen">' + escapeHtml(state.error) + '</div>';
      return;
    }

    var html = '';
    if (state.toast){
      html += '<div class="toast ' + state.toast.type + '">' + escapeHtml(state.toast.msg) + '</div>';
    }

    if (state.manualMode && !state.agent){
      html += manualPickerHtml();
      html += versionTagHtml();
      app.innerHTML = html;
      bindManualPicker();
      return;
    }

    html += badgeHtml();
    if (state.manualMode){
      html += '<div class="manual-picker"><p>Compte non reconnu automatiquement — agent sélectionné manuellement.</p>' +
              '<button class="pill" id="switch-agent">Changer d’agent</button></div>';
    }

    if (!state.formulairesAgent || !state.formulairesAgent.length){
      html += '<div class="panel"><p class="empty-note">Aucun formulaire n’est associé à cet agent pour le moment. Contactez votre responsable pour obtenir un accès.</p></div>';
      html += versionTagHtml();
      app.innerHTML = html;
      bindGlobal();
      return;
    }

    html += segmentedHtml();
    var formulaire = state.formulaires[state.selectedFormulaireId];
    if (formulaire) ensureFieldsLoaded(formulaire.table);
    html += dynamicFormHtml(formulaire);
    html += versionTagHtml();
    html += actionBarHtml();

    app.innerHTML = html;
    bindGlobal();
    bindDynamicForm(formulaire);
  }

  function badgeHtml(){
    var meta = [state.agent.service, state.agent.site].filter(Boolean).join(' · ');
    return '<div class="badge">' +
      '<img class="brand-logo" src="../logo-icon.png" alt="EMMA40" />' +
      '<div class="who">' +
        '<div class="name">' + escapeHtml(state.agent.nom) + '</div>' +
        '<div class="meta">' + escapeHtml(meta) + '</div>' +
      '</div>' +
      '<span class="dot" title="Connecté"></span>' +
    '</div>';
  }

  function manualPickerHtml(){
    var t = state.agentsRaw;
    var opts = '<option value="">— Choisir un agent —</option>';
    if (t) {
      t.id.forEach(function(id, i){
        opts += '<option value="' + id + '">' + escapeHtml(t.Nom_Complet_Agent[i]) + '</option>';
      });
    }
    return '<div class="manual-picker">' +
      '<p>Votre compte ne correspond à aucun agent connu. Sélectionnez votre nom pour continuer.</p>' +
      '<select id="manual-agent-select">' + opts + '</select>' +
    '</div>';
  }

  function segmentedHtml(){
    var buttons = state.formulairesAgent.map(function(f){
      var active = f.id === state.selectedFormulaireId ? ' active' : '';
      return '<button class="' + active.trim() + '" data-form-id="' + f.id + '" title="' + escapeHtml(f.titre) + '">' +
        '<span class="seg-icon">' + escapeHtml(f.icone) + '</span>' +
        '<span class="seg-label">' + escapeHtml(f.titre) + '</span>' +
      '</button>';
    }).join('');
    return '<div class="segmented">' + buttons + '</div>';
  }

  function dynamicFormHtml(formulaire){
    if (!formulaire) return '';
    var fields = schemaCache[formulaire.table];
    if (!fields){
      return '<div class="panel"><div class="state-screen" style="padding:24px 0;"><div class="spinner"></div>Chargement des champs du formulaire…</div></div>';
    }
    var out = '<form id="dynamic-form"><div class="panel">';

    out += '<h2>Intervention</h2>';
    out += fieldWrap(
      '<label for="field-date-intervention">Date d’intervention</label>' +
      '<input type="date" id="field-date-intervention" value="' + todayStr() + '" required>'
    );

    out += '<h2>' + escapeHtml(formulaire.titre) + '</h2>';
    fields.forEach(function(f){
      out += renderField(f);
    });

    out += '</div></form>';
    return out;
  }

  function fieldWrap(inner){
    return '<div class="field">' + inner + '</div>';
  }

  function renderField(f){
    var reqStar = f.required ? ' <span class="req">*</span>' : '';
    var unit = f.unit ? ' <span class="unit">(' + escapeHtml(f.unit) + ')</span>' : '';
    var labelHtml = '<label>' + escapeHtml(f.label) + reqStar + unit + '</label>';
    var id = 'field-' + f.key;

    if (f.type === 'text'){
      return fieldWrap(labelHtml + '<input type="text" id="' + id + '" ' + (f.required?'required':'') +
        (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') + '>');
    }
    if (f.type === 'textarea'){
      return fieldWrap(labelHtml + '<textarea id="' + id + '" ' + (f.required?'required':'') + '></textarea>');
    }
    if (f.type === 'number'){
      return fieldWrap(labelHtml + '<input type="number" step="' + (f.step||'any') + '" id="' + id + '" ' + (f.required?'required':'') + '>');
    }
    if (f.type === 'date'){
      var val = f.today ? todayStr() : '';
      return fieldWrap(labelHtml + '<input type="date" id="' + id + '" value="' + val + '" ' + (f.required?'required':'') + '>');
    }
    if (f.type === 'attachment'){
      return fieldWrap(labelHtml + '<input type="file" id="' + id + '" accept="image/*,application/pdf" capture="environment" multiple>');
    }
    if (f.type === 'bool'){
      var on = f.def ? ' on' : '';
      var urgentClass = f.urgent ? ' urgent' : '';
      return '<div class="field toggle-row' + urgentClass + '" id="row-' + id + '" data-key="' + id + '" data-value="' + (!!f.def) + '">' +
        '<span class="field-label" id="label-' + id + '">' + escapeHtml(f.label) + '</span>' +
        '<button type="button" class="switch' + on + '" id="' + id + '" role="switch" ' +
          'aria-checked="' + (!!f.def) + '" aria-labelledby="label-' + id + '">' +
          '<span class="knob" aria-hidden="true"></span>' +
        '</button>' +
      '</div>';
    }
    if (f.type === 'address'){
      return fieldWrap(
        labelHtml +
        '<div class="address-wrap">' +
          '<input type="text" id="' + id + '" autocomplete="off" ' + (f.required?'required':'') +
            (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') + '>' +
          '<div class="address-suggestions" id="sugg-' + id + '"></div>' +
        '</div>' +
        '<div class="address-status" id="status-' + id + '"></div>'
      );
    }
    if (f.type === 'choice'){
      var pills = f.options.map(function(opt){
        var active = opt === f.def ? ' active' : '';
        return '<button type="button" class="pill' + active + '" data-value="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '</button>';
      }).join('');
      return '<div class="field" id="' + id + '" data-value="' + escapeHtml(f.def || '') + '">' +
        labelHtml + '<div class="pills">' + pills + '</div></div>';
    }
    return '';
  }

  function versionTagHtml(){
    return '<div style="text-align:center;font-size:.7rem;color:var(--muted);padding:6px 0 90px;">build ' + WIDGET_BUILD + '</div>';
  }

  function actionBarHtml(){
    var formulaire = state.formulaires[state.selectedFormulaireId];
    var fieldsReady = !formulaire || !!schemaCache[formulaire.table];
    var disabled = state.submitting || !fieldsReady;
    return '<div class="actionbar"><div class="inner">' +
      '<button type="button" class="ghost" id="reset-btn">Effacer</button>' +
      '<button type="button" class="primary" id="submit-btn"' + (disabled?' disabled':'') + '>' +
        (state.submitting ? 'Enregistrement…' : 'Enregistrer') +
      '</button>' +
    '</div></div>';
  }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ---------------------------------------------------------------
  // Bindings
  // ---------------------------------------------------------------
  function bindManualPicker(){
    var sel = document.getElementById('manual-agent-select');
    if (!sel) return;
    sel.addEventListener('change', function(){
      if (!sel.value) return;
      var idx = state.agentsRaw.id.indexOf(Number(sel.value));
      if (idx >= 0){
        applyAgentFromRow(idx);
        render();
      }
    });
  }

  function bindGlobal(){
    var switchAgent = document.getElementById('switch-agent');
    if (switchAgent){
      switchAgent.addEventListener('click', function(){
        state.agent = null;
        render();
      });
    }
    var segBtns = document.querySelectorAll('.segmented button');
    segBtns.forEach(function(btn){
      btn.addEventListener('click', function(){
        state.selectedFormulaireId = Number(btn.getAttribute('data-form-id'));
        render();
      });
    });
    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', function(){ render(); });
    var submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
  }

  function bindDynamicForm(formulaire){
    var formEl = document.getElementById('dynamic-form');
    if (formEl){
      // Empêche toute soumission native du formulaire (touche Entrée sur
      // mobile, "Go"/"Valider" du clavier virtuel, etc.), qui provoquerait
      // un rechargement complet de la page et interromprait l'enregistrement
      // en cours. Seul le bouton "Enregistrer" doit déclencher l'envoi.
      formEl.addEventListener('submit', function(e){ e.preventDefault(); });
      formEl.addEventListener('keydown', function(e){
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){
          e.preventDefault();
        }
      });
    }
    if (!formulaire) return;
    var fields = schemaCache[formulaire.table] || [];
    fields.forEach(function(f){
      var id = 'field-' + f.key;
      if (f.type === 'address'){
        bindAddressField(id);
      }
      if (f.type === 'bool'){
        var row = document.getElementById('row-' + id);
        var sw = document.getElementById(id);
        if (sw) sw.addEventListener('click', function(){
          var newVal = row.getAttribute('data-value') !== 'true';
          row.setAttribute('data-value', String(newVal));
          sw.classList.toggle('on', newVal);
        });
      }
      if (f.type === 'choice'){
        var wrap = document.getElementById(id);
        if (!wrap) return;
        wrap.querySelectorAll('.pill').forEach(function(pill){
          pill.addEventListener('click', function(){
            wrap.setAttribute('data-value', pill.getAttribute('data-value'));
            wrap.querySelectorAll('.pill').forEach(function(p){ p.classList.remove('active'); });
            pill.classList.add('active');
          });
        });
      }
    });
  }

// ===== app.js =====
// app.js
// Point d'entrée : état global, démarrage (grist.ready), et soumission du
// formulaire (handleSubmit), qui orchestre les autres fichiers.

"use strict";

  var WIDGET_BUILD = '2026-09-04-v17';
  console.log('[Formulaire terrain] build ' + WIDGET_BUILD);

  var grist = window.grist;


  var state = {
    loading:true,
    error:null,
    agent:null,            // {id, nom, site, service, formulaires:[{id,titre,table}]}
    formulaires:{},        // id -> {titre, table, actif}
    agentsRaw:null,        // cached fetchTable('Agents') result, for manual fallback
    manualMode:false,
    selectedFormulaireId:null,
    fieldsLoading:{},     // tableId technique -> booléen, pour éviter les requêtes en double
    submitting:false,
    toast:null
  };

  var app = document.getElementById('f-app');

  // ---------------------------------------------------------------
  // Soumission
  // ---------------------------------------------------------------
  async function handleSubmit(){
    if (state.submitting) return;
    var formulaire = state.formulaires[state.selectedFormulaireId];
    if (!formulaire) return;

    var formEl = document.getElementById('dynamic-form');
    if (formEl && !formEl.reportValidity()) return;

    // IMPORTANT : on lit toutes les valeurs du formulaire AVANT de toucher
    // au DOM ou à state.submitting. Un render() ici régénérerait le HTML
    // (y compris les champs) et effacerait ce que l'agent a saisi.
    var dateVal = document.getElementById('field-date-intervention').value;
    var dateEpoch = dateStrToEpoch(dateVal);

    var fields = schemaCache[formulaire.table] || [];
    var values = {};
    var pendingFiles = [];

    for (var i = 0; i < fields.length; i++){
      var f = fields[i];
      var id = 'field-' + f.key;

      if (f.type === 'attachment'){
        var fileInput = document.getElementById(id);
        if (fileInput && fileInput.files && fileInput.files.length){
          pendingFiles.push({ key: f.key, files: fileInput.files });
        }
      } else if (f.type === 'bool'){
        var row = document.getElementById('row-' + id);
        values[f.key] = row ? row.getAttribute('data-value') === 'true' : false;
      } else if (f.type === 'choice'){
        var wrap = document.getElementById(id);
        values[f.key] = wrap ? (wrap.getAttribute('data-value') || null) : null;
      } else if (f.type === 'number'){
        var el = document.getElementById(id);
        values[f.key] = (el && el.value !== '') ? Number(el.value) : null;
      } else if (f.type === 'date'){
        var elD = document.getElementById(id);
        values[f.key] = dateStrToEpoch(elD ? elD.value : null);
      } else {
        var elT = document.getElementById(id);
        values[f.key] = elT ? elT.value : '';
      }
    }

    // On avait tenté de pré-assigner l'id de la future ligne Reponses pour
    // tout envoyer en un seul lot atomique. Grist refuse cependant les id
    // "trop hauts" par rapport à la taille actuelle de la table (structure
    // interne dimensionnée sur l'id max utilisé) — donc un id choisi côté
    // client, quelle que soit sa valeur, n'est pas fiable ici.
    //
    // On revient à la méthode standard : laisser Grist assigner les id
    // automatiquement, en deux appels séparés. Pour ne pas laisser de
    // ligne orpheline dans Reponses si la deuxième écriture échoue (règle
    // ACL, validation…), on supprime automatiquement la ligne Reponses
    // qu'on vient de créer dans ce cas précis (compensation).
    async function addReponseAndDetail(tokenInfo, reponseFields, technicalTable, technicalValuesBase){
      var addReponseRet = await applyActionsViaRest(tokenInfo, [
        ['AddRecord', 'Reponses', null, reponseFields]
      ]);
      var reponseId = Array.isArray(addReponseRet) ? addReponseRet[0] : addReponseRet;
      var technicalValues = Object.assign({}, technicalValuesBase, { Reponse: reponseId });

      try {
        await applyActionsViaRest(tokenInfo, [
          ['AddRecord', technicalTable, null, technicalValues]
        ]);
      } catch (detailErr) {
        try {
          await applyActionsViaRest(tokenInfo, [
            ['RemoveRecord', 'Reponses', reponseId]
          ]);
        } catch (rollbackErr) {
          console.error('Échec de la compensation (suppression de la ligne Reponses orpheline)', rollbackErr);
        }
        throw detailErr;
      }
    }

    // À partir d'ici, on ne redessine plus le formulaire tant que la
    // soumission n'est pas terminée : on grise juste le bouton directement.
    state.submitting = true;
    state.toast = null;
    var submitBtn = document.getElementById('submit-btn');
    if (submitBtn){
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enregistrement…';
    }

    try {
      // Un seul jeton pour toute la soumission (upload des pièces jointes ET
      // création des lignes via /apply), pour que tout se fasse sous la
      // même identité côté serveur.
      var tokenInfo;
      try {
        tokenInfo = await grist.docApi.getAccessToken({ readOnly: false });
      } catch (tokenErr) {
        throw new Error('Jeton d’accès refusé : ' + (tokenErr && tokenErr.message ? tokenErr.message : tokenErr));
      }

      // Les pièces jointes sont envoyées AVANT la création des lignes :
      // ça ne dépend d'aucun id de ligne, et si l'upload échoue on continue
      // quand même (on ne bloque jamais l'enregistrement pour une photo).
      var attachmentWarning = false;
      var attachmentErrorDetail = '';
      for (var j = 0; j < pendingFiles.length; j++){
        var pf = pendingFiles[j];
        var attIds = [];
        try {
          for (var k = 0; k < pf.files.length; k++){
            var attId = await uploadAttachmentViaRest(pf.files[k], tokenInfo);
            attIds.push(attId);
          }
          // Les colonnes Pièce jointe attendent un tableau préfixé par
          // l'indicateur de type "L" (Liste), pas un tableau brut
          // d'identifiants — sinon Grist essaie d'interpréter le premier
          // élément comme un code de type et affiche #KeyError.
          values[pf.key] = ['L'].concat(attIds);
        } catch (uploadErr) {
          console.error('Échec upload pièce jointe (' + pf.key + ')', uploadErr);
          attachmentWarning = true;
          attachmentErrorDetail = uploadErr && uploadErr.message ? uploadErr.message : String(uploadErr);
          // on continue sans cette pièce jointe plutôt que de tout bloquer
        }
      }

      await addReponseAndDetail(
        tokenInfo,
        {
          Agent: state.agent.id,
          Formulaire: state.selectedFormulaireId,
          Date_Intervention: dateEpoch,
          Statut: 'Déclaré'
        },
        formulaire.table,
        values
      );

      state.toast = attachmentWarning
        ? { type:'error', msg:'Enregistré, mais la photo n’a pas pu être envoyée (' + attachmentErrorDetail + ').' }
        : { type:'success', msg:'Formulaire enregistré.' };
    } catch (err) {
      console.error(err);
      state.toast = { type:'error', msg:'Échec de l’enregistrement : ' + (err && err.message ? err.message : err) };
    } finally {
      state.submitting = false;
      render();
      if (state.toast && state.toast.type === 'success'){
        setTimeout(function(){ state.toast = null; render(); }, 3500);
      }
    }
  }

  // ---------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------
  // Filet de sécurité : toute erreur JS non interceptée ailleurs s'affiche
  // ici plutôt que de rester silencieuse (utile pour déboguer sur mobile,
  // où la console n'est pas accessible).
  window.addEventListener('error', function(e){
    state.toast = { type:'error', msg:'Erreur : ' + (e.message || e) };
    render();
  });
  window.addEventListener('unhandledrejection', function(e){
    var reason = e.reason && e.reason.message ? e.reason.message : e.reason;
    state.toast = { type:'error', msg:'Erreur : ' + reason };
    render();
  });

  // Démarrage exposé pour l'orchestrateur (app-shell.js) : plus de
  // grist.ready() ici (un seul appel global couvre tout le widget
  // fusionné), et plus d'exécution automatique au chargement du
  // fichier — nécessaire puisque ce script coexiste maintenant avec
  // 2 autres écrans sur la même page.
  window.FormulaireApp = {
    init: function () {
      loadData()
        .then(function(){
          state.loading = false;
          render();
        })
        .catch(function(err){
          console.error(err);
          state.loading = false;
          state.error = 'Impossible de charger les données du document : ' + (err && err.message ? err.message : err);
          render();
        });
    }
  };


})();
