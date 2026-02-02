/**
 * Composable pour la validation des formulaires avec Joi
 * Simplifie l'utilisation de la validation dans les composants Vue
 */

import { ref, reactive } from 'vue'
import { validateData } from '@/utils/validation.js'

export function useValidation() {
  const isValidating = ref(false)
  const errors = reactive({})

  /**
   * Valide des données avec un schéma
   * @param {Object} data - Données à valider
   * @param {Object} schema - Schéma Joi
   * @returns {Promise<boolean>} - true si valide
   */
  const validate = async (data, schema) => {
    isValidating.value = true

    // Réinitialiser les erreurs
    Object.keys(errors).forEach((key) => delete errors[key])

    try {
      const result = validateData(data, schema)

      if (!result.isValid) {
        // Ajouter les erreurs au reactive object
        Object.assign(errors, result.errors)
        return false
      }

      return true
    } catch (error) {
      console.error('Erreur de validation:', error)
      errors.general = 'Erreur de validation inattendue'
      return false
    } finally {
      isValidating.value = false
    }
  }

  /**
   * Valide un champ spécifique
   * @param {string} fieldName - Nom du champ
   * @param {any} value - Valeur à valider
   * @param {Object} fieldSchema - Schéma Joi pour ce champ
   * @returns {boolean} - true si valide
   */
  const validateField = (fieldName, value, fieldSchema) => {
    const result = validateData({ [fieldName]: value }, { [fieldName]: fieldSchema })

    if (!result.isValid) {
      errors[fieldName] = result.errors[fieldName]
      return false
    } else {
      delete errors[fieldName]
      return true
    }
  }

  /**
   * Efface les erreurs
   */
  const clearErrors = () => {
    Object.keys(errors).forEach((key) => delete errors[key])
  }

  /**
   * Efface l'erreur d'un champ spécifique
   * @param {string} fieldName - Nom du champ
   */
  const clearFieldError = (fieldName) => {
    delete errors[fieldName]
  }

  /**
   * Vérifie si un champ a une erreur
   * @param {string} fieldName - Nom du champ
   * @returns {boolean}
   */
  const hasError = (fieldName) => {
    return !!errors[fieldName]
  }

  /**
   * Récupère l'erreur d'un champ
   * @param {string} fieldName - Nom du champ
   * @returns {string|undefined}
   */
  const getError = (fieldName) => {
    return errors[fieldName]
  }

  /**
   * Vérifie s'il y a des erreurs
   * @returns {boolean}
   */
  const hasErrors = () => {
    return Object.keys(errors).length > 0
  }

  return {
    isValidating,
    errors,
    validate,
    validateField,
    clearErrors,
    clearFieldError,
    hasError,
    getError,
    hasErrors,
  }
}

/**
 * Composable spécialisé pour la validation en temps réel
 * Valide automatiquement quand les données changent
 */
export function useRealtimeValidation(schema) {
  const { validate, errors, clearErrors, hasErrors } = useValidation()
  const isValid = ref(false)

  /**
   * Valide les données et met à jour isValid
   * @param {Object} data - Données à valider
   */
  const validateRealtime = async (data) => {
    isValid.value = await validate(data, schema)
    return isValid.value
  }

  return {
    isValid,
    errors,
    validateRealtime,
    clearErrors,
    hasErrors,
  }
}
