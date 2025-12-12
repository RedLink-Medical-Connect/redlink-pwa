import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function usePassword() {
  const { t } = useI18n()

  const password = ref('')
  const confirmPassword = ref('')

  const isValid = computed(() => {
    if (!password.value) return true
    return password.value.length >= 8
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
