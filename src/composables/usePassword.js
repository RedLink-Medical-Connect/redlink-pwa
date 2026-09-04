import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function usePassword() {
  const { t } = useI18n()

  const password = ref('')
  const confirmPassword = ref('')

  // Synchronisé avec `cfnUserPool.policies.passwordPolicy` (amplify/backend.ts) : un mot
  // de passe accepté ici ne doit jamais être rejeté par Cognito. 12 caractères minimum,
  // au moins une minuscule/majuscule/chiffre/symbole.
  const isValid = computed(() => {
    if (!password.value) return true
    return (
      password.value.length >= 12 &&
      /[a-z]/.test(password.value) &&
      /[A-Z]/.test(password.value) &&
      /[0-9]/.test(password.value) &&
      /[^a-zA-Z0-9]/.test(password.value)
    )
  })

  const doMatch = computed(() => {
    return password.value === confirmPassword.value
  })

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
