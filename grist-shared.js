// grist-shared.js
// Fonctions utilitaires partagées entre les widgets qui parlent à
// l'API REST de Grist via un jeton d'accès (getAccessToken) — pour
// l'instant : Formulaire terrain (envoi de pièces jointes) et
// Consultation (miniatures de pièces jointes).
//
// À placer à la racine du dépôt, chargé via un chemin relatif
// ("../grist-shared.js"), AVANT tout fichier qui utilise ces
// fonctions (grist-api.js pour Formulaire, app.js pour Consultation).
//
// Contexte du contournement ci-dessous : voir la section "Pièces
// jointes" de API_Grist_Widget_Reference.md.

// Décode le payload d'un jeton JWT (non chiffré, juste encodé en
// base64url) pour en extraire le docId canonique — nécessaire car
// tokenInfo.baseUrl est parfois construit avec l'identifiant "court"
// du document plutôt que celui, canonique, encodé dans le jeton.
function decodeJwtDocId(token) {
  try {
    var payloadB64 = token.split('.')[1];
    var normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    var payload = JSON.parse(atob(normalized));
    return payload && payload.docId ? payload.docId : null;
  } catch (e) {
    return null;
  }
}

// Corrige tokenInfo.baseUrl si besoin, en le reconstruisant avec le
// docId canonique extrait du jeton lui-même.
function buildApiBase(tokenInfo) {
  var canonicalDocId = decodeJwtDocId(tokenInfo.token);
  var m = tokenInfo.baseUrl.match(/^(.*\/api\/docs\/)([^\/?]+)$/);
  var baseUrl = tokenInfo.baseUrl;
  if (m && canonicalDocId && m[2] !== canonicalDocId) {
    baseUrl = m[1] + canonicalDocId;
    console.log('[grist-shared] baseUrl corrigée : ' + tokenInfo.baseUrl + ' -> ' + baseUrl);
  }
  return baseUrl;
}
