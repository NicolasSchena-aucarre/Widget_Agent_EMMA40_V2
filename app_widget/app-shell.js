// app-shell.js — orchestrateur du widget fusionné.
//
// Remplace à la fois : l'appel grist.ready() (un seul, pour tout le
// widget), et nav.js (dont le rôle devient "changer d'écran interne"
// plutôt que "changer de page Grist").
//
// Principe : les 3 écrans (Formulaire, Tableau de bord, Consultation)
// sont chargés sur la MÊME page Grist, dans des conteneurs séparés,
// affichés/masqués en JS — jamais de rechargement de page au clic.

(function () {
  'use strict';

  var SCREENS = [
    { key: 'formulaire', label: 'Formulaire', icon: '📝', gateTable: 'Portail_Agent', app: function () { return window.FormulaireApp; } },
    { key: 'dashboard', label: 'Tableau de bord', icon: '📊', gateTable: 'Postes', app: function () { return window.DashboardApp; } },
    { key: 'consultation', label: 'Consultation', icon: '🔍', gateTable: null, app: function () { return window.ConsultationApp; } }
  ];

  var initialized = {}; // key -> booléen, pour n'appeler .init() qu'une seule fois par écran
  var currentKey = null;

  // ---------------------------------------------------------------
  // Vérification d'accès (même principe que l'ancien nav.js) : une
  // table vide ou illisible pour l'utilisateur connecté = onglet masqué.
  // ---------------------------------------------------------------
  async function canAccess(screen) {
    if (!screen.gateTable) return true;
    try {
      var table = await grist.docApi.fetchTable(screen.gateTable);
      return table.id.length > 0;
    } catch (err) {
      console.error('[app-shell] accès refusé (ou vérification impossible) pour "' + screen.key + '" (table ' + screen.gateTable + ')', err);
      return false;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildNav(visibleScreens) {
    var nav = document.getElementById('app-nav');
    nav.innerHTML = visibleScreens.map(function (s) {
      return '<button type="button" data-screen="' + s.key + '">' +
        '<span class="nav-icon">' + s.icon + '</span>' +
        '<span class="nav-label">' + escapeHtml(s.label) + '</span>' +
      '</button>';
    }).join('');

    nav.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showScreen(btn.getAttribute('data-screen'));
      });
    });
  }

  function updateActiveButton() {
    document.querySelectorAll('#app-nav button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-screen') === currentKey);
    });
  }

  function showScreen(key) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById('screen-' + s.key);
      if (el) el.hidden = (s.key !== key);
    });
    currentKey = key;
    updateActiveButton();

    // Initialisation "au premier affichage" : chaque écran ne démarre
    // son propre chargement de données qu'une seule fois, quel que
    // soit le nombre de fois où on y revient ensuite.
    var screen = SCREENS.filter(function (s) { return s.key === key; })[0];
    if (screen && !initialized[key]) {
      initialized[key] = true;
      var app = screen.app();
      if (app && typeof app.init === 'function') {
        app.init();
      } else {
        console.error('[app-shell] ' + key + 'App introuvable ou sans méthode init() au moment de l’affichage.');
      }
    }
  }

  async function boot() {
    grist.ready({ requiredAccess: 'full' });

    var accessFlags = await Promise.all(SCREENS.map(canAccess));
    var visibleScreens = SCREENS.filter(function (s, i) { return accessFlags[i]; });

    if (!visibleScreens.length) {
      document.body.innerHTML = '<div class="state-screen">Aucun écran accessible avec ce compte.</div>';
      return;
    }

    buildNav(visibleScreens);

    // Écran de départ : le premier accessible dans l'ordre de priorité
    // Formulaire > Tableau de bord > Consultation (plutôt qu'un ordre
    // arbitraire), pour que chaque rôle atterrisse sur ce qui le
    // concerne le plus directement.
    showScreen(visibleScreens[0].key);

    // Chargement en parallèle des AUTRES écrans accessibles, en arrière-
    // plan, pour qu'ils soient déjà prêts si l'utilisateur clique dessus
    // juste après — c'est ce qui rend le changement d'onglet instantané.
    visibleScreens.slice(1).forEach(function (s) {
      if (!initialized[s.key]) {
        initialized[s.key] = true;
        var app = s.app();
        if (app && typeof app.init === 'function') app.init();
      }
    });
  }

  boot();
})();
