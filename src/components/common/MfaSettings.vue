<script setup>
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { useMfa } from '@/composables/useMfa'

// Section "Double authentification" partagée SettingsView.vue (clinic)/ProfileView.vue
// (owner) -- MFA TOTP disponible aux deux rôles sans logique spécifique à l'un des deux,
// voir CLAUDE.md (Groupe 4 du durcissement sécurité Cognito/API).
const props = defineProps({
  accountName: {
    type: String,
    required: true
  }
})

const { t } = useI18n()
const {
  isLoading,
  error,
  isEnabled,
  setupDetails,
  fetchStatus,
  startEnrollment,
  cancelEnrollment,
  confirmEnrollment,
  disable
} = useMfa()

const verificationCode = ref('')
const qrDataUrl = ref('')

onMounted(() => {
  fetchStatus()
})

// `setupDetails.uri` (otpauth://) est déjà généré par useMfa.js (getSetupUri()) -- le rendu
// visuel en QR code manquait, seule la clé manuelle était affichée jusqu'ici.
watch(
  () => setupDetails.value?.uri,
  async (uri) => {
    qrDataUrl.value = uri ? await QRCode.toDataURL(uri) : ''
  },
)

const onStartEnrollment = () => {
  verificationCode.value = ''
  startEnrollment(props.accountName)
}

const onConfirm = async () => {
  if (verificationCode.value.length < 6) return
  const success = await confirmEnrollment(verificationCode.value)
  if (success) verificationCode.value = ''
}

const onCancel = () => {
  verificationCode.value = ''
  cancelEnrollment()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h2
      class="text-xl font-bold text-zinc-900 dark:text-white border-l-4 border-[#ff3b4e] pl-3"
    >
      {{ t('dashboard.mfa.title') }}
    </h2>
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{{ t('dashboard.mfa.description') }}</p>

    <Message v-if="error" severity="error" class="text-left">
      {{ t(error) }}
    </Message>

    <div v-if="isLoading && !setupDetails" class="p-6 text-center">
      <i class="pi pi-spin pi-spinner text-2xl text-[#ff3b4e]"></i>
    </div>

    <template v-else-if="setupDetails">
      <div v-if="qrDataUrl" class="flex justify-center p-4">
        <img
          :src="qrDataUrl"
          :alt="t('dashboard.mfa.qr_alt')"
          width="200"
          height="200"
          class="rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
      </div>

      <div
        class="p-4 bg-zinc-50 dark:bg-zinc-950/50 rounded-lg border border-zinc-200 dark:border-zinc-800 flex flex-col gap-2"
      >
        <p class="text-xs font-bold uppercase text-zinc-500">
          {{ t('dashboard.mfa.manual_key_label') }}
        </p>
        <code class="text-sm font-mono break-all text-zinc-900 dark:text-white">{{
          setupDetails.sharedSecret
        }}</code>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          {{ t('dashboard.mfa.manual_key_hint') }}
        </p>
      </div>

      <div class="flex flex-col gap-2 max-w-xs">
        <label class="text-xs font-bold text-zinc-500 uppercase">{{
          t('dashboard.mfa.code_label')
        }}</label>
        <InputOtp v-model="verificationCode" :length="6" integer-only />
      </div>

      <div class="flex gap-3">
        <Button
          :label="t('dashboard.mfa.confirm')"
          :loading="isLoading"
          :disabled="verificationCode.length < 6"
          class="!bg-[#ff3b4e] !border-[#ff3b4e] !text-white font-bold px-6"
          @click="onConfirm"
        />
        <Button :label="t('common.cancel')" text class="!text-zinc-500" @click="onCancel" />
      </div>
    </template>

    <div
      v-else
      class="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-zinc-950/50 rounded-lg border border-zinc-200 dark:border-zinc-800"
    >
      <div class="flex items-center gap-3">
        <i
          class="pi pi-shield text-xl"
          :class="isEnabled ? 'text-green-600' : 'text-zinc-400'"
        ></i>
        <span class="text-sm font-medium">
          {{ isEnabled ? t('dashboard.mfa.status_enabled') : t('dashboard.mfa.status_disabled') }}
        </span>
      </div>
      <Button
        v-if="!isEnabled"
        :label="t('dashboard.mfa.enable')"
        :loading="isLoading"
        class="!bg-[#ff3b4e] !border-[#ff3b4e] !text-white font-bold px-4"
        @click="onStartEnrollment"
      />
      <Button
        v-else
        :label="t('dashboard.mfa.disable')"
        severity="danger"
        outlined
        :loading="isLoading"
        @click="disable"
      />
    </div>
  </div>
</template>
