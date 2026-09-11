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

  // -----------------------------------------------------------------
  // Seul endroit du widget où les noms de rôle apparaissent. Si un rôle
  // est un jour renommé (ex. "Agent" -> "Technicien"), c'est ici — et
  // uniquement ici côté widget — qu'il faut le répercuter. Les Règles
  // d'accès du document, elles, devront toujours être corrigées à la
  // main séparément : Grist ne propage pas un tel renommage tout seul,
  // ni dans les règles ni dans le code d'un widget.
  // -----------------------------------------------------------------
  var ROLE = {
    AGENT: 'Agent',
    MANAGER: 'Manager',
    RESP_SITE: 'Responsable_Site',
    DIRECTION: 'Direction'
  };

  var SCREENS = [
    { key: 'formulaire', label: 'Formulaire', icon: '📝', visibleFor: [ROLE.AGENT], app: function () { return window.FormulaireApp; } },
    { key: 'dashboard', label: 'Tableau de bord', icon: '📊', visibleFor: [ROLE.MANAGER, ROLE.RESP_SITE, ROLE.DIRECTION], app: function () { return window.DashboardApp; } },
    { key: 'consultation', label: 'Consultation', icon: '🔍', visibleFor: null, app: function () { return window.ConsultationApp; } } // null = tous les rôles
  ];

  var initialized = {}; // key -> booléen, pour n'appeler .init() qu'une seule fois par écran
  var currentKey = null;

  // ---------------------------------------------------------------
  // Détermination du rôle et visibilité des écrans
  // ---------------------------------------------------------------
  // Lit UNE seule fois le rôle de la personne connectée, via sa propre
  // ligne Utilisateur (Règle d'accès : rec.Email == user.Email → +R,
  // chacun ne lit que sa propre ligne, jamais celle des autres). En cas
  // d'échec (règle absente, aucune ligne trouvée...), on retombe sur
  // null : seuls les écrans ouverts à tous (visibleFor: null) restent
  // alors visibles — un repli prudent plutôt qu'un accès accordé par
  // erreur.
  async function fetchMyRole() {
    try {
      var table = await grist.docApi.fetchTable('Utilisateur');
      if (!table.id.length) {
        console.error('[app-shell] aucune ligne Utilisateur lisible pour cette personne — vérifiez la règle "rec.Email == user.Email" sur cette table.');
        return null;
      }
      return table.Role[0] || null;
    } catch (err) {
      console.error('[app-shell] échec de la lecture du rôle', err);
      return null;
    }
  }

  function canAccess(screen, myRole) {
    return !screen.visibleFor || screen.visibleFor.indexOf(myRole) !== -1;
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

    var myRole = await fetchMyRole();
    var visibleScreens = SCREENS.filter(function (s) { return canAccess(s, myRole); });

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
