---
status: accepted
---

# Écriture atomique conditionnelle sur l'acceptation d'une Mission

Le CdC (§2.3) décrit un fan-out de notifications push à plusieurs Owners compatibles
pour une Request d'urgence, l'envoi s'arrêtant "dès la première réponse positive" —
plusieurs Owners peuvent donc légitimement tenter d'accepter la même Request en même
temps. Un simple re-check de `status === OPEN` suivi d'une écriture laisserait une
fenêtre de course entre les deux propriétaires concurrents. `acceptMission` condition
son écriture sur `Request.status = OPEN` (échec propre si déjà pris) plutôt que de
faire confiance à une vérification préalable séparée.
