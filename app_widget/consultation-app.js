// app.js
(function () {
  'use strict';

  var WIDGET_BUILD = '2026-09-08-v5';
  console.log('[Consultation] build ' + WIDGET_BUILD);

  var state = {
    reponses: [],
    formulaires: [],
    formulaireLabels: {},
    agentLabels: {},
    siteLabels: {},
    serviceLabels: {},
    selectedId: null,
    technicalCache: {} // "tableId:reponseId" -> ligne technique déjà récupérée
  };

  function init() {
    // grist.ready() n'est plus appelé ici : un seul appel global, fait
    // une fois par l'orchestrateur (app-shell.js), couvre aussi cet écran.
    document.getElementById('c-version-tag').textContent = 'build ' + WIDGET_BUILD;
    document.getElementById('c-btn-refresh').addEventListener('click', loadAndRender);
    loadAndRender();
  }

  async function loadAndRender() {
    try {
      var data = await ConsultationData.loadAll();
      state.reponses = data.reponses.sort(function (a, b) { return b.Date_Intervention - a.Date_Intervention; });
      state.formulaires = data.formulaires;
      state.formulaireLabels = data.formulaireLabels;
      state.agentLabels = data.agentLabels;
      state.siteLabels = data.siteLabels;
      state.serviceLabels = data.serviceLabels;
      state.technicalCache = {};

      document.getElementById('c-state-screen').hidden = true;
      document.getElementById('c-main').hidden = false;

      renderList();
      renderDetail(); // vide au premier chargement, sauf si une sélection existait déjà
    } catch (err) {
      console.error('[Consultation] échec du chargement', err);
      document.getElementById('c-state-screen').textContent =
        'Impossible de charger les données : ' + (err && err.message ? err.message : err);
    }
  }

  // ---------------------------------------------------------------
  // Liste
  // ---------------------------------------------------------------
  function formatDate(epochSeconds) {
    if (!epochSeconds) return '';
    var d = new Date(epochSeconds * 1000);
    return d.toLocaleDateString('fr-FR');
  }

  function renderList() {
    var listEl = document.getElementById('c-list');
    document.getElementById('c-list-count').textContent =
      state.reponses.length + ' réponse' + (state.reponses.length > 1 ? 's' : '');

    if (!state.reponses.length) {
      listEl.innerHTML = '<div class="list-empty">Aucune réponse visible avec votre rôle actuel.</div>';
      return;
    }

    listEl.innerHTML = state.reponses.map(function (r) {
      var active = r.id === state.selectedId ? ' active' : '';
      var titre = state.formulaireLabels[r.Formulaire] || 'Formulaire inconnu';
      var agent = state.agentLabels[r.Agent] || '';
      return '<div class="list-item' + active + '" data-id="' + r.id + '">' +
        '<div class="li-title">' + escapeHtml(titre) + '</div>' +
        '<div class="li-sub">' + escapeHtml(formatDate(r.Date_Intervention)) +
          (agent ? ' — ' + escapeHtml(agent) : '') + '</div>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.list-item').forEach(function (el) {
      el.addEventListener('click', function () {
        state.selectedId = Number(el.getAttribute('data-id'));
        renderList();
        renderDetail();
      });
    });
  }

  // ---------------------------------------------------------------
  // Détail (formulaire rempli, lecture seule)
  // ---------------------------------------------------------------
  async function renderDetail() {
    var emptyEl = document.getElementById('c-detail-empty');
    var contentEl = document.getElementById('c-detail-content');

    if (state.selectedId === null) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      return;
    }

    var reponse = state.reponses.filter(function (r) { return r.id === state.selectedId; })[0];
    if (!reponse) { emptyEl.hidden = false; contentEl.hidden = true; return; }

    emptyEl.hidden = true;
    contentEl.hidden = false;
    if (minimapInstance) { minimapInstance.remove(); minimapInstance = null; }
    contentEl.innerHTML = '<div class="state-screen" style="padding:24px 0;"><div class="spinner"></div>Chargement du détail…</div>';

    var formulaire = state.formulaires.filter(function (f) { return f.id === reponse.Formulaire; })[0];
    if (!formulaire || !formulaire.Table_Technique) {
      contentEl.innerHTML = '<div class="detail-empty">Ce formulaire n’a pas de table technique configurée.</div>';
      return;
    }
    var tableId = formulaire.Table_Technique;

    try {
      var cacheKey = tableId + ':' + reponse.id;
      var technicalRow = state.technicalCache[cacheKey];
      if (!technicalRow) {
        technicalRow = await ConsultationData.fetchTechnicalRow(tableId, reponse.id);
        state.technicalCache[cacheKey] = technicalRow;
      }

      var fields = await ConsultationData.discoverDisplayFields(tableId);

      var html = '<div class="detail-header"><h2>' + escapeHtml(state.formulaireLabels[reponse.Formulaire] || '') + '</h2>' +
        '<div class="detail-meta">' +
          '<span>Date : <b>' + escapeHtml(formatDate(reponse.Date_Intervention)) + '</b></span>' +
          '<span>Agent : <b>' + escapeHtml(state.agentLabels[reponse.Agent] || '—') + '</b></span>' +
          '<span>Site : <b>' + escapeHtml(state.siteLabels[reponse.Site] || '—') + '</b></span>' +
          '<span>Service : <b>' + escapeHtml(state.serviceLabels[reponse.Service] || '—') + '</b></span>' +
          '<span>Statut : <b>' + escapeHtml(reponse.Statut || '—') + '</b></span>' +
        '</div></div>';

      if (!technicalRow) {
        html += '<div class="detail-empty">Aucun détail technique trouvé pour cette réponse.</div>';
      } else {
        html += fields.map(function (f) { return fieldRowHtml(f, technicalRow[f.key]); }).join('');
        var hasAddressField = fields.some(function (f) { return f.key === 'Adresse'; });
        if (hasAddressField && technicalRow.Adresse) {
          html += '<div class="minimap-wrap"><div class="minimap" id="c-minimap"></div>' +
            '<div class="minimap-status" id="c-minimap-status"></div></div>';
        }
      }

      contentEl.innerHTML = html;

      if (technicalRow && technicalRow.Adresse) {
        renderMinimap(technicalRow.Adresse);
      }

      // Les vignettes de pièces jointes sont chargées après coup (elles
      // ont besoin d'un jeton d'accès, récupéré une seule fois).
      var attachmentFields = fields.filter(function (f) { return f.kind === 'attachment'; });
      if (attachmentFields.length) fillAttachmentThumbnails(attachmentFields, technicalRow);

    } catch (err) {
      console.error('[Consultation] échec du rendu du détail', err);
      contentEl.innerHTML = '<div class="detail-empty">Impossible d’afficher le détail : ' +
        escapeHtml(err && err.message ? err.message : err) + '</div>';
    }
  }

  var minimapInstance = null;

  async function renderMinimap(address) {
    var statusEl = document.getElementById('c-minimap-status');
    var mapEl = document.getElementById('c-minimap');
    if (!mapEl) return;

    if (statusEl) statusEl.textContent = 'Localisation de l’adresse…';

    var geo = await ConsultationData.geocodeAddress(address);

    // L'utilisateur a pu changer de sélection pendant le géocodage :
    // on vérifie que le conteneur existe toujours avant de dessiner.
    mapEl = document.getElementById('c-minimap');
    if (!mapEl) return;

    if (minimapInstance) {
      minimapInstance.remove();
      minimapInstance = null;
    }

    if (!geo) {
      if (statusEl) statusEl.textContent = 'Adresse non localisable sur la carte.';
      return;
    }

    if (statusEl) statusEl.textContent = '';

    minimapInstance = L.map(mapEl, {
      zoomControl: true,
      scrollWheelZoom: true,
      dragging: true,
      attributionControl: true
    }).setView([geo.lat, geo.lon], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(minimapInstance);

    L.marker([geo.lat, geo.lon]).addTo(minimapInstance);

    // Leaflet a besoin de connaître la taille réelle du conteneur ; comme
    // celui-ci vient d'être inséré dans le DOM, un léger différé évite un
    // rendu tronqué (bug classique de Leaflet dans un conteneur qui
    // vient d'apparaître).
    setTimeout(function () { if (minimapInstance) minimapInstance.invalidateSize(); }, 50);
  }

  function fieldRowHtml(field, value) {
    var displayValue;
    var valueClass = '';

    if (value === null || value === undefined || value === '') {
      displayValue = '—';
      valueClass = 'empty';
    } else if (field.kind === 'bool') {
      displayValue = value ? 'Oui' : 'Non';
      valueClass = value ? 'bool-yes' : 'bool-no';
    } else if (field.kind === 'date') {
      displayValue = formatDate(value);
    } else if (field.kind === 'attachment') {
      var ids = ConsultationData.toList(value);
      if (!ids.length) { displayValue = '—'; valueClass = 'empty'; }
      else {
        // Conteneur rempli plus tard par fillAttachmentThumbnails, une
        // fois le jeton d'accès obtenu.
        return '<div class="field-row"><div class="field-label">' + escapeHtml(field.label) + '</div>' +
          '<div class="field-value"><div class="attachment-list" data-attachment-ids="' + ids.join(',') + '"></div></div></div>';
      }
    } else {
      displayValue = String(value);
    }

    return '<div class="field-row"><div class="field-label">' + escapeHtml(field.label) + '</div>' +
      '<div class="field-value ' + valueClass + '">' + escapeHtml(displayValue) + '</div></div>';
  }

  // ---------------------------------------------------------------
  // Pièces jointes : miniatures via jeton d'accès temporaire
  // ---------------------------------------------------------------
  // Point non vérifié : getAccessToken sous l'accès "read table" (plutôt
  // que "full"). Si les miniatures ne s'affichent pas, essayer de passer
  // requiredAccess à 'full' dans init() en premier réflexe de diagnostic.
  // decodeJwtDocId / buildApiBase viennent de grist-shared.js (chargé
  // avant ce fichier) — partagées avec le widget Formulaire terrain,
  // qui a exactement le même besoin.

  async function fillAttachmentThumbnails(attachmentFields, technicalRow) {
    try {
      var tokenInfo = await grist.docApi.getAccessToken({ readOnly: true });
      var base = buildApiBase(tokenInfo);

      document.querySelectorAll('.attachment-list[data-attachment-ids]').forEach(function (container) {
        var ids = container.getAttribute('data-attachment-ids').split(',').filter(Boolean);
        container.innerHTML = '';
        ids.forEach(function (id) {
          var url = base + '/attachments/' + id + '/download?auth=' + encodeURIComponent(tokenInfo.token);

          var wrap = document.createElement('div');
          wrap.className = 'attachment-item';

          var img = document.createElement('img');
          img.className = 'attachment-thumb';
          img.alt = 'Pièce jointe — cliquer pour agrandir';
          img.src = url;
          img.addEventListener('click', function () {
            openImageModal(url);
          });
          img.addEventListener('error', function () {
            wrap.innerHTML = '';
            var link = document.createElement('a');
            link.className = 'attachment-link';
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'Pièce jointe ' + id;
            wrap.appendChild(link);
          });

          var dlBtn = document.createElement('a');
          dlBtn.className = 'attachment-dl';
          dlBtn.href = url;
          dlBtn.download = '';
          dlBtn.title = 'Télécharger';
          dlBtn.textContent = '⬇';

          wrap.appendChild(img);
          wrap.appendChild(dlBtn);
          container.appendChild(wrap);
        });
      });
    } catch (err) {
      console.error('[Consultation] échec du chargement des miniatures', err);
      document.querySelectorAll('.attachment-list[data-attachment-ids]').forEach(function (container) {
        container.textContent = 'Pièce(s) jointe(s) non affichable(s) ici.';
      });
    }
  }

  function openImageModal(url) {
    document.getElementById('c-modal-image').src = url;
    document.getElementById('c-modal-download').href = url;
    document.getElementById('c-modal-overlay').hidden = false;
  }

  function closeImageModal() {
    document.getElementById('c-modal-overlay').hidden = true;
    document.getElementById('c-modal-image').src = '';
  }

  function bindModalOnce() {
    document.getElementById('c-modal-close').addEventListener('click', closeImageModal);
    document.getElementById('c-modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'c-modal-overlay') closeImageModal(); // clic sur le fond, pas sur l'image
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeImageModal();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.ConsultationApp = {
    init: function () {
      init();
      bindModalOnce();
    }
  };
})();
