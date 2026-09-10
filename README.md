# EMMA40 — Widget d'interventions terrain (fusionné)

Widget Grist personnalisé unique, réunissant les trois usages du projet Emma40 en une seule page, avec bascule instantanée entre les écrans (aucun rechargement de page) :

- **Formulaire terrain** — saisie d'une intervention par un agent.
- **Tableau de bord** — pilotage : répartition des interventions par formulaire, site, service.
- **Consultation** — recherche et détail d'une intervention déjà déclarée, avec carte de localisation.

Chaque personne ne voit que les écrans correspondant à son rôle (voir [Qui voit quoi](#qui-voit-quoi) plus bas) ; le passage de l'un à l'autre se fait via un menu interne (rail à gauche sur ordinateur, barre d'onglets en bas sur tablette/téléphone), sans jamais quitter la page Grist.

> Ce dépôt correspond à la version **fusionnée** du widget (un seul widget, une seule page Grist). Une version antérieure à trois pages séparées existe par ailleurs dans un autre dépôt — les deux ne sont pas interchangeables : voir [Différence avec la version à 3 pages](#différence-avec-la-version-à-3-pages).

## Structure du dépôt

```
/
├── style.css          # Styles partagés par les 3 écrans
├── app-shell.css      # Styles du menu de navigation interne
├── grist-shared.js    # Utilitaires REST partagés (upload/lecture de pièces jointes)
├── logo-icon.png      # Logo EMMA40 (icône seule), affiché dans l'en-tête de chaque écran
└── app_widget/
    ├── index.html            # Point d'entrée unique du widget
    ├── app-shell.js          # Orchestrateur : connexion à Grist, menu, bascule d'écran
    ├── formulaire-app.js     # Écran Formulaire terrain
    ├── dashboard-data.js     # Écran Tableau de bord — récupération des données
    ├── dashboard-charts.js   # Écran Tableau de bord — graphiques (Chart.js)
    ├── dashboard-app.js      # Écran Tableau de bord — orchestration de l'écran
    ├── consultation-data.js  # Écran Consultation — récupération des données
    └── consultation-app.js   # Écran Consultation — orchestration de l'écran
```

Seuls les fichiers du dossier `app_widget/` sont propres à ce widget ; les fichiers à la racine sont pensés pour être partagés avec d'éventuels autres widgets du même document à l'avenir.

## Mise en place dans Grist

1. Publiez ce dépôt (GitHub Pages, ou tout hébergement statique équivalent).
2. Dans Grist, ajoutez **un seul** widget personnalisé, pointant vers l'URL de `app_widget/index.html`.
3. Ouvrez la page contenant ce widget avec `?embed=true` (ou `?style=singlePage`) ajouté à la fin de l'URL pour masquer le menu propre à Grist (pages, colonnes, personnalisation) et n'afficher que le widget en plein écran.

Aucune configuration d'URL n'est nécessaire dans le code : contrairement à une navigation entre plusieurs pages Grist, ce widget ne connaît qu'une seule page (la sienne) et n'a donc aucune adresse à renseigner quelque part.

## Qui voit quoi

Le menu n'affiche que les écrans auxquels la personne connectée a réellement accès — déterminé en tentant de lire une table Grist qui sert de "porte" à chaque écran :

| Écran | Table-porte | Accès |
|---|---|---|
| Formulaire terrain | `Portail_Agent` | Agents |
| Tableau de bord | `Postes` | Managers, Responsables de site, Direction |
| Consultation | *(aucune)* | Tout le monde |

Ce mécanisme suppose que chaque table-porte contient **au moins une ligne** (peu importe son contenu) — une table vide pour tout le monde ne permet pas de distinguer "accès refusé" de "il n'y a simplement rien dedans". La sécurité réelle reste portée par les Règles d'accès du document ; ce menu n'en est qu'un reflet côté interface.

## Différence avec la version à 3 pages

Une version antérieure du projet répartissait ces trois écrans sur trois pages Grist distinctes, avec un menu qui naviguait d'une page à l'autre (rechargement complet à chaque changement). Cette version fusionnée règle l'inconvénient principal de l'ancienne (le rechargement, perceptible et un peu lourd) en réunissant les trois écrans dans un seul widget, avec bascule en JavaScript plutôt qu'en navigation de page. Les deux versions sont fonctionnellement équivalentes ; elles ne doivent pas être déployées en même temps sur le même document.

## Bibliothèques externes utilisées

- [Chart.js 4.4.4](https://www.chartjs.org/) — graphiques du Tableau de bord.
- [Leaflet 1.9.4](https://leafletjs.com/) — mini-carte de localisation dans Consultation.
- [API Adresse (BAN)](https://adresse.data.gouv.fr/) — autocomplétion et géocodage d'adresse, service public gratuit sans clé.

Toutes trois sont chargées depuis un CDN public ; un accès réseau sortant est donc nécessaire pour leur bon fonctionnement.
