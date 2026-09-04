// Durcissement sécurité (audit Cognito/API, 2026-09-02, Groupe 3) : `temp_register_safe_data`
// (localStorage) porte des PII (adresse, téléphone, données santé animale) le temps du flux
// inscription -> vérification email. TTL applicatif pour éviter une persistance indéfinie en
// cas d'abandon du flow -- lu par VerifyEmailView.vue, posé par RegisterOwnerView.vue/
// RegisterClinicView.vue (voir `savedAt` dans le payload stocké).
export const TEMP_REGISTRATION_TTL_MS = 30 * 60 * 1000
