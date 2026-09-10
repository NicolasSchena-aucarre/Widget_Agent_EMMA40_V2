// grist-config.js
// ===================================================================
// SEUL fichier à modifier si vous changez de document Grist ou
// d'instance (self-hosted, autre organisation...). Aucun autre fichier
// des 3 widgets ne contient d'URL ou d'identifiant propre à ce
// document précis — tout le reste se connecte automatiquement à
// l'endroit où le widget est chargé, via l'API Grist elle-même.
//
// À placer à la racine du dépôt, chargé par chaque widget via un
// chemin relatif ("../grist-config.js"), AVANT nav.js.
// ===================================================================

// Destinations du menu de navigation partagé (voir nav.js). Pour
// chaque destination :
//   key   : identifiant interne, doit correspondre à window.CURRENT_VIEW
//           défini dans l'index.html de ce widget.
//   label : texte affiché sous l'icône dans le menu.
//   icon  : emoji affiché dans le menu.
//   url   : URL complète de la page Grist correspondante, avec
//           ?embed=true (ou ?style=singlePage) à la fin.
//   gateTable : nom de la table Grist qui sert de "porte" ACL à cette
//           page (voir IT_Creation_Nouveau_Formulaire.md / Note
//           technique) — le bouton n'apparaît que si l'utilisateur
//           connecté peut lire au moins une ligne de cette table.
//           Mettre `null` si la page est ouverte à tous les rôles
//           (c'est le cas de Consultation).
//
//           Important : pour qu'une table serve de porte fiable, elle
//           doit contenir AU MOINS UNE LIGNE (même une seule, sans
//           signification) — une table qui reste vide pour tout le
//           monde ne permet pas de distinguer "accès refusé" de
//           "il n'y a simplement rien dedans".
var NAV_DESTINATIONS = [
  {
    key: 'formulaire',
    label: 'Formulaire',
    icon: '📝',
    url: 'https://docs.getgrist.com/VOTRE_DOC_ID/VOTRE_DOC_NOM/p/XX?embed=true',
    gateTable: 'Portail_Agent'
  },
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    icon: '📊',
    url: 'https://docs.getgrist.com/VOTRE_DOC_ID/VOTRE_DOC_NOM/p/YY?embed=true',
    gateTable: 'Postes'
  },
  {
    key: 'consultation',
    label: 'Consultation',
    icon: '🔍',
    url: 'https://docs.getgrist.com/VOTRE_DOC_ID/VOTRE_DOC_NOM/p/ZZ?embed=true',
    gateTable: null
  }
];
