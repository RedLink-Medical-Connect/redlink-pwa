/**
 * Schémas de validation Joi pour RedLink
 * Sécurise toutes les entrées utilisateur
 */

import Joi from 'joi'
import { Species, DonationFrequency } from '@/constants/enums.js'

// ===========================================
// SCHÉMAS DE BASE
// ===========================================

const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .required()
  .messages({
    'string.email': 'Adresse email invalide',
    'any.required': "L'email est obligatoire",
  })

const passwordSchema = Joi.string()
  .min(8)
  .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)'))
  .required()
  .messages({
    'string.min': 'Le mot de passe doit contenir au moins 8 caractères',
    'string.pattern.base':
      'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    'any.required': 'Le mot de passe est obligatoire',
  })

const phoneSchema = Joi.string().pattern(new RegExp('^\\+?[1-9]\\d{1,14}$')).required().messages({
  'string.pattern.base': 'Numéro de téléphone invalide (format international requis)',
  'any.required': 'Le numéro de téléphone est obligatoire',
})

const nameSchema = Joi.string()
  .min(2)
  .max(50)
  .pattern(new RegExp("^[a-zA-ZÀ-ÿ\\s\\-']+$"))
  .required()
  .messages({
    'string.min': 'Le nom doit contenir au moins 2 caractères',
    'string.max': 'Le nom ne peut pas dépasser 50 caractères',
    'string.pattern.base':
      'Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes',
    'any.required': 'Le nom est obligatoire',
  })

// ===========================================
// AUTHENTIFICATION
// ===========================================

export const loginSchema = Joi.object({
  email: emailSchema,
  password: Joi.string().required().messages({
    'any.required': 'Le mot de passe est obligatoire',
  }),
})

export const registerOwnerSchema = Joi.object({
  email: emailSchema,
  password: passwordSchema,
  firstname: nameSchema,
  lastname: nameSchema,
  phone: phoneSchema,
  address: Joi.string().min(10).max(200).required().messages({
    'string.min': "L'adresse doit contenir au moins 10 caractères",
    'string.max': "L'adresse ne peut pas dépasser 200 caractères",
    'any.required': "L'adresse est obligatoire",
  }),
  maxTravelDistance: Joi.number().integer().min(5).max(200).required().messages({
    'number.min': 'La distance minimale est de 5 km',
    'number.max': 'La distance maximale est de 200 km',
    'any.required': 'La distance de déplacement est obligatoire',
  }),
})

export const registerClinicSchema = Joi.object({
  // Vétérinaire
  veterinarian: Joi.object({
    email: emailSchema,
    password: passwordSchema,
    firstname: nameSchema,
    lastname: nameSchema,
  }).required(),

  // Clinique
  clinic: Joi.object({
    name: Joi.string().min(3).max(100).required().messages({
      'string.min': 'Le nom de la clinique doit contenir au moins 3 caractères',
      'string.max': 'Le nom de la clinique ne peut pas dépasser 100 caractères',
      'any.required': 'Le nom de la clinique est obligatoire',
    }),
    rpps: Joi.string().pattern(new RegExp('^\\d{11}$')).required().messages({
      'string.pattern.base': 'Le numéro RPPS doit contenir exactement 11 chiffres',
      'any.required': 'Le numéro RPPS est obligatoire',
    }),
    email: emailSchema,
    phone: phoneSchema,
    address: Joi.string().min(10).max(200).required(),
    hasEmergencyService: Joi.boolean().required(),
  }).required(),
})

// ===========================================
// ANIMAUX
// ===========================================

export const animalSchema = Joi.object({
  name: Joi.string()
    .min(2)
    .max(30)
    .pattern(new RegExp("^[a-zA-ZÀ-ÿ\\s\\-']+$"))
    .required()
    .messages({
      'string.min': "Le nom de l'animal doit contenir au moins 2 caractères",
      'string.max': "Le nom de l'animal ne peut pas dépasser 30 caractères",
      'string.pattern.base':
        'Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes',
      'any.required': "Le nom de l'animal est obligatoire",
    }),

  species: Joi.string()
    .valid(...Object.values(Species))
    .required()
    .messages({
      'any.only': "L'espèce doit être DOG ou CAT",
      'any.required': "L'espèce est obligatoire",
    }),

  breed: Joi.string().max(50).allow('').messages({
    'string.max': 'La race ne peut pas dépasser 50 caractères',
  }),

  birthDate: Joi.date().max('now').min('1990-01-01').allow(null).messages({
    'date.max': 'La date de naissance ne peut pas être dans le futur',
    'date.min': 'Date de naissance trop ancienne',
  }),

  weight: Joi.number().positive().min(0.5).max(200).required().messages({
    'number.positive': 'Le poids doit être positif',
    'number.min': 'Le poids minimum est de 0.5 kg',
    'number.max': 'Le poids maximum est de 200 kg',
    'any.required': 'Le poids est obligatoire',
  }),

  bloodGroup: Joi.string().required().messages({
    'any.required': 'Le groupe sanguin est obligatoire',
  }),

  isVaccinated: Joi.boolean().required().messages({
    'any.required': 'Le statut de vaccination est obligatoire',
  }),

  isSterilized: Joi.boolean().allow(null),

  donationFrequency: Joi.string()
    .valid(...Object.values(DonationFrequency))
    .required()
    .messages({
      'any.only': 'La fréquence de donation doit être ASAP, TWICE_YEAR ou ONCE_YEAR',
      'any.required': 'La fréquence de donation est obligatoire',
    }),
})

// ===========================================
// DEMANDES DE TRANSFUSION
// ===========================================

export const requestSchema = Joi.object({
  requestType: Joi.string().valid('EMERGENCY', 'APPOINTMENT').required().messages({
    'any.only': 'Le type de demande doit être EMERGENCY ou APPOINTMENT',
    'any.required': 'Le type de demande est obligatoire',
  }),

  requiredSpecies: Joi.string()
    .valid(...Object.values(Species))
    .required()
    .messages({
      'any.only': "L'espèce requise doit être DOG ou CAT",
      'any.required': "L'espèce requise est obligatoire",
    }),

  requiredBloodGroup: Joi.string().required().messages({
    'any.required': 'Le groupe sanguin requis est obligatoire',
  }),

  quantity: Joi.number().integer().min(1).max(10).required().messages({
    'number.integer': 'La quantité doit être un nombre entier',
    'number.min': 'La quantité minimale est de 1',
    'number.max': 'La quantité maximale est de 10',
    'any.required': 'La quantité est obligatoire',
  }),

  patientName: Joi.string().max(50).allow('').messages({
    'string.max': 'Le nom du patient ne peut pas dépasser 50 caractères',
  }),

  details: Joi.string().max(500).allow('').messages({
    'string.max': 'Les détails ne peuvent pas dépasser 500 caractères',
  }),
})

// ===========================================
// DISPONIBILITÉS
// ===========================================

export const availabilitySchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).required().messages({
    'number.integer': 'Le jour de la semaine doit être un nombre entier',
    'number.min': 'Le jour de la semaine doit être entre 0 (dimanche) et 6 (samedi)',
    'number.max': 'Le jour de la semaine doit être entre 0 (dimanche) et 6 (samedi)',
    'any.required': 'Le jour de la semaine est obligatoire',
  }),

  startTime: Joi.string()
    .pattern(new RegExp('^([01]?[0-9]|2[0-3]):[0-5][0-9]$'))
    .required()
    .messages({
      'string.pattern.base': "L'heure de début doit être au format HH:MM (ex: 09:00)",
      'any.required': "L'heure de début est obligatoire",
    }),

  endTime: Joi.string()
    .pattern(new RegExp('^([01]?[0-9]|2[0-3]):[0-5][0-9]$'))
    .required()
    .messages({
      'string.pattern.base': "L'heure de fin doit être au format HH:MM (ex: 18:00)",
      'any.required': "L'heure de fin est obligatoire",
    }),
})

// ===========================================
// FONCTIONS UTILITAIRES
// ===========================================

/**
 * Valide des données avec un schéma Joi
 * @param {Object} data - Données à valider
 * @param {Object} schema - Schéma Joi
 * @returns {Object} { isValid, errors, value }
 */
export const validateData = (data, schema) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false, // Retourne toutes les erreurs
    stripUnknown: true, // Supprime les champs non définis dans le schéma
  })

  if (error) {
    const errors = error.details.reduce((acc, detail) => {
      acc[detail.path.join('.')] = detail.message
      return acc
    }, {})

    return {
      isValid: false,
      errors,
      value: null,
    }
  }

  return {
    isValid: true,
    errors: {},
    value,
  }
}

/**
 * Valide les groupes sanguins selon l'espèce
 * @param {string} species - Espèce (DOG/CAT)
 * @param {string} bloodGroup - Groupe sanguin
 * @returns {boolean}
 */
export const validateBloodGroup = (species, bloodGroup) => {
  const validGroups = {
    DOG: ['DEA 1.1-', 'DEA 1.1+', 'Dal', 'Kai'],
    CAT: ['A', 'B', 'AB'],
  }

  return validGroups[species]?.includes(bloodGroup) || false
}

/**
 * Valide l'éligibilité d'un animal donneur
 * @param {Object} animal - Données de l'animal
 * @returns {Object} { isEligible, reasons }
 */
export const validateDonorEligibility = (animal) => {
  const reasons = []

  // Poids minimum selon l'espèce
  const minWeight = animal.species === 'DOG' ? 25 : 4
  if (animal.weight < minWeight) {
    reasons.push(`Poids insuffisant (minimum ${minWeight}kg pour ${animal.species})`)
  }

  // Âge (calculé à partir de birthDate)
  if (animal.birthDate) {
    const age = new Date().getFullYear() - new Date(animal.birthDate).getFullYear()
    if (age < 1) reasons.push('Trop jeune (minimum 1 an)')
    if (age > 8) reasons.push('Trop âgé (maximum 8 ans)')
  }

  // Vaccination obligatoire
  if (!animal.isVaccinated) {
    reasons.push('Vaccination requise')
  }

  // Dernière donation (si applicable)
  if (animal.lastDonationDate) {
    const daysSinceLastDonation = Math.floor(
      (new Date() - new Date(animal.lastDonationDate)) / (1000 * 60 * 60 * 24),
    )
    if (daysSinceLastDonation < 56) {
      // 8 semaines
      reasons.push(
        `Délai insuffisant depuis la dernière donation (${daysSinceLastDonation}/56 jours)`,
      )
    }
  }

  return {
    isEligible: reasons.length === 0,
    reasons,
  }
}
