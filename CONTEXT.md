# Redlink

Plateforme de mise en relation entre cliniques vétérinaires en recherche de sang et
propriétaires d'animaux donneurs potentiels (Owners), en urgence ou sur rendez-vous.

## Language

**Request**:
Un besoin de sang exprimé par une Clinic — espèce et groupe sanguin requis, type
(urgence ou rendez-vous) et statut.
_Avoid_: Demande, Mission

**Mission**:
L'engagement d'un Animal Validated Donor envers une Request, créé au moment où son
Owner accepte de le fournir.
_Avoid_: Request, Don, Rendez-vous

**Eligibility**:
L'ensemble des cinq critères hiérarchisés qui déterminent si un Animal peut être
proposé comme donneur pour une Request : statut de Validated Donor, compatibilité
sanguine, respect de la Frequency Rule, proximité géographique, Clinic Priority.
_Avoid_: Matching, Compatibilité (ne couvre qu'un des cinq critères)

**Validated Donor**:
Un Animal dont un vétérinaire a confirmé l'aptitude au don et le groupe sanguin, pour
une durée d'un an renouvelable en consultation. Un groupe sanguin connu est un
prérequis à la validation elle-même — il n'existe pas d'Animal Validated Donor à
groupe sanguin inconnu. Un Animal qui n'est pas (ou plus) Validated Donor n'est jamais
candidat à une Request, quelle que soit sa compatibilité par ailleurs.
_Avoid_: Vacciné / Stérilisé (attributs médicaux distincts, sans lien avec l'agrément
donneur) ; Mission Validation (voir plus bas — même mot, concept sans rapport)

**Mission Validation** (double validation) :
La confirmation, par LES DEUX parties d'une Mission (Owner ET Clinic, indépendamment
l'une de l'autre), que le don a réellement eu lieu — condition requise pour qu'une
Mission passe à `COMPLETED`. Sans réponse d'un des deux côtés sous un délai
configurable, la Mission est finalisée automatiquement (`COMPLETED_AUTO`) ; en cas de
réponses contradictoires, elle passe `DISPUTED`. Voir `submitMissionValidation`
(`amplify/data/resource.ts`), ADR-0018/0019/0020.
_Avoid_: Validation (seul, ambigu avec Validated Donor ci-dessus), Clôture (l'ancien
terme, avant la double validation — une seule partie ne peut plus "clore" une Mission
unilatéralement)

**Frequency Rule**:
La règle qui rend un Animal temporairement inéligible entre deux dons, selon la date
de son dernier don et sa fréquence de don acceptée.
_Avoid_: Disponibilité (réservé aux créneaux renseignés par l'Owner pour les dons non
urgents — un concept différent)

**Clinic Priority**:
Le critère qui favorise, sans les exclure, les Owners déjà rattachés à la clinique
émettrice d'une Request.
