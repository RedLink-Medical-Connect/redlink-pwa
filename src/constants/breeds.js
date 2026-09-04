import { Species } from '@/constants/enums.js'

// Listes de races reconnues (FCI pour le chien, LOOF/FIFe pour le chat) -- demande
// produit 2026-08-23 : remplacer le champ race en texte libre par un menu déroulant
// avec recherche (pattern AddressAutocomplete.vue, voir BreedAutocomplete.vue),
// complétée 2026-09-01 (couverture trop faible + liste non traduite en anglais).
//
// Chaque race est un CODE stable (jamais localisé, jamais affiché tel quel) -- le
// libellé vient de `common.breeds.<CODE>` dans src/locales/{fr,en}.json, résolu par
// `breedLabel()` ci-dessous. Une valeur déjà en base AVANT ce changement (ancien format
// texte libre, ex. 'Labrador Retriever') ne correspond à aucun CODE : `breedLabel()` la
// renvoie telle quelle (repli), donc aucune régression d'affichage sur les données
// existantes -- seules les nouvelles sélections bénéficient de la traduction.
//
// Ces listes visent une couverture large des races courantes en clientèle vétérinaire
// française, pas l'exhaustivité stricte du standard FCI (~360 races canines) -- une race
// absente reste saisissable via l'option 'Autre' en fin de liste (OTHER_BREED_CODE), qui
// laisse alors le champ texte libre ouvert (voir BreedAutocomplete.vue).

// Sentinel -- pas une race, une clé i18n dédiée ('common.breed_other'), toujours en fin
// de liste. Bascule BreedAutocomplete.vue en saisie libre quand sélectionné.
export const OTHER_BREED_CODE = 'AUTRE'

export const DogBreeds = Object.freeze([
  'AFFENPINSCHER',
  'AIREDALE_TERRIER',
  'AKITA_AMERICAIN',
  'AKITA_INU',
  'ALASKAN_MALAMUTE',
  'AMERICAN_BULLY',
  'AMERICAN_STAFFORDSHIRE_TERRIER',
  'AUSTRALIAN_TERRIER',
  'BASENJI',
  'BASSET_ARTESIEN_NORMAND',
  'BASSET_BLEU_DE_GASCOGNE',
  'BASSET_FAUVE_DE_BRETAGNE',
  'BASSET_HOUND',
  'BEAGLE',
  'BEAGLE_HARRIER',
  'BEARDED_COLLIE',
  'BEAUCERON',
  'BEDLINGTON_TERRIER',
  'BERGER_ALLEMAND',
  'BERGER_ANATOLIE',
  'BERGER_AUSTRALIEN',
  'BERGER_BELGE_GROENENDAEL',
  'BERGER_BELGE_LAEKENOIS',
  'BERGER_BELGE_MALINOIS',
  'BERGER_BELGE_TERVUEREN',
  'BERGER_BLANC_SUISSE',
  'BERGER_DES_PYRENEES',
  'BERGER_ISLANDE',
  'BERGER_PICARD',
  'BICHON_FRISE',
  'BICHON_HAVANAIS',
  'BICHON_MALTAIS',
  'BOERBOEL',
  'BORDER_COLLIE',
  'BORDER_TERRIER',
  'BOSTON_TERRIER',
  'BOULEDOGUE_FRANCAIS',
  'BOUVIER_AUSTRALIEN',
  'BOUVIER_BERNOIS',
  'BOUVIER_DES_FLANDRES',
  'BOXER',
  'BRAQUE_ALLEMAND',
  'BRAQUE_DE_WEIMAR',
  'BRAQUE_FRANCAIS',
  'BRAQUE_HONGROIS',
  'BRIARD',
  'BULL_TERRIER',
  'BULLDOG_ANGLAIS',
  'BULLMASTIFF',
  'CAIRN_TERRIER',
  'CANE_CORSO',
  'CANICHE',
  'CARLIN',
  'CAVALIER_KING_CHARLES',
  'CHIEN_EAU_PORTUGAIS',
  'CHIEN_LOUP_TCHECOSLOVAQUE',
  'CHIEN_MONTAGNE_PYRENEES',
  'CHIEN_PHARAONS',
  'CHIHUAHUA',
  'CHOW_CHOW',
  'CIRNECO_ETNA',
  'COCKER_AMERICAIN',
  'COCKER_ANGLAIS',
  'COLLEY',
  'CORGI_CARDIGAN',
  'CORGI_PEMBROKE',
  'COTON_DE_TULEAR',
  'CROISE',
  'DALMATIEN',
  'DOBERMANN',
  'DOGUE_ALLEMAND',
  'DOGUE_ARGENTIN',
  'DOGUE_CANARIES',
  'DOGUE_DE_BORDEAUX',
  'DOGUE_DU_TIBET',
  'EPAGNEUL_BRETON',
  'EPAGNEUL_FRANCAIS',
  'EPAGNEUL_JAPONAIS',
  'EPAGNEUL_NAIN_CONTINENTAL',
  'EURASIER',
  'FILA_BRASILEIRO',
  'FOX_TERRIER_POIL_DUR',
  'FOX_TERRIER_POIL_LISSE',
  'GOLDEN_RETRIEVER',
  'GRAND_BLEU_DE_GASCOGNE',
  'GRIFFON_BRUXELLOIS',
  'GRIFFON_FAUVE_DE_BRETAGNE',
  'GRIFFON_KORTHALS',
  'HOVAWART',
  'HUSKY_SIBERIEN',
  'JACK_RUSSELL_TERRIER',
  'JAGDTERRIER',
  'KERRY_BLUE_TERRIER',
  'KING_CHARLES_SPANIEL',
  'KOMONDOR',
  'KUVASZ',
  'LABRADOR_RETRIEVER',
  'LAGOTTO_ROMAGNOLO',
  'LEONBERG',
  'LEVRIER_AFGHAN',
  'LEVRIER_ANGLAIS',
  'LEVRIER_ECOSSAIS',
  'LEVRIER_ESPAGNOL',
  'LEVRIER_IRLANDAIS',
  'LHASSA_APSO',
  'MASTIFF',
  'MASTIFF_NAPOLITAIN',
  'NORFOLK_TERRIER',
  'NORWICH_TERRIER',
  'PARSON_RUSSELL_TERRIER',
  'PATTERDALE_TERRIER',
  'PEKINOIS',
  'PETIT_BASSET_GRIFFON_VENDEEN',
  'PINSCHER_NAIN',
  'PODENCO_IBICENCO',
  'PODENGO_PORTUGAIS',
  'POINTER_ANGLAIS',
  'PULI',
  'RATIER_DE_PRAGUE',
  'RHODESIAN_RIDGEBACK',
  'ROTTWEILER',
  'SAINT_BERNARD',
  'SALUKI',
  'SAMOYEDE',
  'SCHIPPERKE',
  'SCHNAUZER_GEANT',
  'SCHNAUZER_MOYEN',
  'SCHNAUZER_NAIN',
  'SEALYHAM_TERRIER',
  'SETTER_ANGLAIS',
  'SETTER_GORDON',
  'SETTER_IRLANDAIS',
  'SHAR_PEI',
  'SHETLAND_SHEEPDOG',
  'SHIBA_INU',
  'SHIH_TZU',
  'SPITZ_ALLEMAND',
  'SPITZ_FINNOIS',
  'SPITZ_JAPONAIS',
  'SPITZ_NAIN_POMERANIEN',
  'SPRINGER_ANGLAIS',
  'STAFFORDSHIRE_BULL_TERRIER',
  'TECKEL',
  'TERRE_NEUVE',
  'TERRIER_BRESILIEN',
  'TERRIER_TIBETAIN',
  'TOSA',
  'VOLPINO_ITALIEN',
  'WEST_HIGHLAND_WHITE_TERRIER',
  'WHIPPET',
  'XOLOITZCUINTLE',
  'YORKSHIRE_TERRIER',
  // Toujours en dernier -- voir BreedAutocomplete.vue (bascule vers un champ texte libre).
  OTHER_BREED_CODE,
])

export const CatBreeds = Object.freeze([
  'ABYSSIN',
  'AMERICAN_CURL',
  'AMERICAN_SHORTHAIR',
  'AMERICAN_WIREHAIR',
  'ANGORA_TURC',
  'AUSTRALIAN_MIST',
  'BALINAIS',
  'BENGAL',
  'BIRMAN',
  'BLEU_RUSSE',
  'BOBTAIL_AMERICAIN',
  'BOBTAIL_JAPONAIS',
  'BOBTAIL_KOURILES',
  'BOMBAY',
  'BRITISH_LONGHAIR',
  'BRITISH_SHORTHAIR',
  'BURMESE',
  'BURMILLA',
  'CHANTILLY_TIFFANY',
  'CHARTREUX',
  'CHAUSIE',
  'CORNISH_REX',
  'CYMRIC',
  'DEVON_REX',
  'DONSKOY',
  'EUROPEEN',
  'EXOTIC_SHORTHAIR',
  'FORET_NORVEGIENNE',
  'HAVANA_BROWN',
  'HIMALAYEN',
  'KORAT',
  'LAPERM',
  'MAINE_COON',
  'MANX',
  'MAU_EGYPTIEN',
  'MUNCHKIN',
  'NEBELUNG',
  'OCICAT',
  'ORIENTAL',
  'PERSAN',
  'PETERBALD',
  'PIXIEBOB',
  'RAGAMUFFIN',
  'RAGDOLL',
  'SAVANNAH',
  'SCOTTISH_FOLD',
  'SCOTTISH_STRAIGHT',
  'SELKIRK_REX',
  'SIAMOIS',
  'SIBERIEN',
  'SINGAPURA',
  'SNOWSHOE',
  'SOMALI',
  'SPHYNX',
  'THAI',
  'TONKINOIS',
  'TOYGER',
  // Toujours en dernier -- voir BreedAutocomplete.vue (bascule vers un champ texte libre).
  OTHER_BREED_CODE,
])

/**
 * Liste de codes de race pour une espèce donnée. Fonction (pas un simple objet indexé)
 * pour rester cohérente avec `BloodGroupsBySpecies[species]`/le repli `|| []` déjà
 * utilisé partout ailleurs dans le repo pour une espèce absente/non reconnue.
 *
 * @param {string} species Species.DOG ou Species.CAT
 * @returns {readonly string[]}
 */
export const breedsForSpecies = (species) => {
  if (species === Species.DOG) return DogBreeds
  if (species === Species.CAT) return CatBreeds
  return []
}

/**
 * Libellé affiché pour un code de race -- même raisonnement que `formatBloodGroupLabel`
 * (constants/enums.js) : fonction pure, prend `t`/`te` déjà résolus par l'appelant
 * (`useI18n()`) plutôt que de les récupérer ici, pour rester utilisable dans un slot de
 * template comme dans une fonction utilitaire hors composant.
 *
 * `te(key)` (translation exists) plutôt qu'un test sur le résultat de `t(key)` : une
 * valeur historique en texte libre (donnée enregistrée avant ce changement, ex.
 * 'Labrador Retriever') ne doit déclencher aucun warning `vue-i18n` de clé manquante --
 * elle est renvoyée telle quelle, à l'identique de l'affichage d'avant ce correctif.
 *
 * @param {string} value Code de race (ex. 'BERGER_ALLEMAND') ou texte libre historique/'Autre'.
 * @param {(key: string) => string} t
 * @param {(key: string) => boolean} te
 * @returns {string}
 */
export const breedLabel = (value, t, te) => {
  if (!value) return value
  if (value === OTHER_BREED_CODE) return t('common.breed_other')
  const key = `common.breeds.${value}`
  return te(key) ? t(key) : value
}
