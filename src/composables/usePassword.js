import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function usePassword() {
  const { t } = useI18n()

  const password = ref('')
  const confirmPassword = ref('')

  // Vérifie la longueur
  const isValid = computed(() => {
    if (!password.value) return true // Pas d'erreur si vide (UX)
    return password.value.length >= 8
  })

  // Vérifie la correspondance
  const doMatch = computed(() => {
    return password.value === confirmPassword.value
  })

  // Fonction de validation globale pour le submit
  const validate = () => {
    if (!isValid.value) return t('errors.password_length')
    if (!doMatch.value) return t('errors.passwords_not_match')
    return null
  }

  return {
    password,
    confirmPassword,
    isValid,
    doMatch,
    validate
  }
}
