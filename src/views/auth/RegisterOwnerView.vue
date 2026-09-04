<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePassword } from '@/composables/usePassword'
import { useI18n } from 'vue-i18n'
import AddressAutocomplete from '@/components/common/AddressAutocomplete.vue'
import BreedAutocomplete from '@/components/common/BreedAutocomplete.vue'
import PhoneInput from '@/components/common/PhoneInput.vue'
import {
  Species,
  DonationFrequency,
  BloodGroupsBySpecies,
  AnimalSex,
  formatBloodGroupLabel,
} from '@/constants/enums.js'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const {
  password,
  confirmPassword,
  isValid: isPasswordValid,
  validate: validatePassword,
} = usePassword()

const step = ref(1)
const isLoading = ref(false)

const form = ref({
  lastname: '',
  firstname: '',
  email: '',
  phone: '',
  address: '',
  latitude: null,
  longitude: null,

  animal_name: '',
  animal_species: Species.DOG,
  animal_breed: '',
  animal_sex: null,
  animal_birthDate: '',
  animal_weight: null,
  blood_group: '',
  // Harmonisation avec AddAnimalView.vue (demande produit 2026-08-23) : mêmes champs,
  // mêmes défauts (false/false/ASAP) -- avant ce correctif, ces trois valeurs étaient
  // fabriquées en silence par useRegistrationCompletion.js, jamais montrées au
  // propriétaire (isVaccinated forcé à true en particulier).
  animal_isVaccinated: false,
  animal_isSterilized: false,
  animal_donationFrequency: DonationFrequency.ASAP,

  // Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) — jamais pré-coché (le consentement
  // doit être un acte positif, demande produit explicite) : `false` par défaut, pas
  // d'initialisation à `true`.
  cguAccepted: false,
  privacyAccepted: false,
})

const bloodOptions = computed(() => {
  return BloodGroupsBySpecies[form.value.animal_species] || []
})

// Harmonisé avec AddAnimalView.vue (même forme {label, value}) -- remplace le <select>
// HTML brut d'origine, seul endroit du repo qui n'utilisait pas le composant PrimeVue
// Select pour ce choix.
const speciesOptions = computed(() => [
  { label: t('request.species.dog'), value: Species.DOG },
  { label: t('request.species.cat'), value: Species.CAT },
])

const sexOptions = computed(() => [
  { label: t('dashboard.owner.animals.sex.male'), value: AnimalSex.MALE },
  { label: t('dashboard.owner.animals.sex.female'), value: AnimalSex.FEMALE },
])

// Mêmes clés i18n qu'AddAnimalView.vue (dashboard.owner.animals.*) plutôt que d'en
// dupliquer sous auth.register_owner.* -- les deux vues affichent littéralement le même
// libellé pour le même champ.
const frequencyOptions = computed(() => [
  { label: t('dashboard.owner.animals.frequency.asap'), value: DonationFrequency.ASAP },
  { label: t('dashboard.owner.animals.frequency.twice_year'), value: DonationFrequency.TWICE_YEAR },
  { label: t('dashboard.owner.animals.frequency.once_year'), value: DonationFrequency.ONCE_YEAR },
])

const nextStep = () => {
  if (!form.value.lastname || !form.value.firstname || !form.value.email || !password.value) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }

  const passwordError = validatePassword()
  if (passwordError) {
    auth.setError(passwordError)
    return
  }

  if (!form.value.latitude || !form.value.longitude) {
    auth.setError(t('errors.invalid_address'))
    return
  }

  // Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) : les deux cases ne sont jamais
  // pré-cochées (voir `form` ci-dessus), donc bloquantes ici tant qu'elles ne sont pas
  // explicitement cochées — même garde-fou repris côté composable
  // (`useRegistrationCompletion.js`, `CONSENT_REQUIRED`) en défense en profondeur.
  if (!form.value.cguAccepted || !form.value.privacyAccepted) {
    auth.setError(t('errors.consent_required'))
    return
  }

  auth.clearError()
  step.value = 2
}

const onAddressSelect = (data) => {
  form.value.address = data.address
  form.value.latitude = data.latitude
  form.value.longitude = data.longitude
}

const handleRegister = async () => {
  // Sous-tâche 6.1 : bloodGroup est le seul champ obligatoire ajouté à ce step 2 —
  // sans lui, `useAnimals.js`/`createAnimalSimple` enverrait un `bloodGroup` vide
  // (accepté par le schéma, `String!`) et l'Animal ne matcherait jamais aucune Request
  // à groupe précis, sans le moindre avertissement (voir roadmap 6.1).
  if (!form.value.blood_group) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }

  isLoading.value = true
  auth.clearError()

  try {
    const success = await auth.register(
      form.value.email,
      password.value,
      `${form.value.firstname} ${form.value.lastname}`,
      'owner',
    )
    if (!success) return

    const payload = {
      ...form.value,
      role: 'owner',
    }

    auth.setTempRegistrationData({
      ...payload,
      password: password.value,
    })

    const safePayload = { data: { ...payload }, savedAt: Date.now() }
    localStorage.setItem('temp_register_safe_data', JSON.stringify(safePayload))

    await router.push({ name: 'verify-email', query: { email: form.value.email } })
  } catch (err) {
    console.error(err)
    auth.setError(err.message || t('errors.registration_failed'))
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
    <div
      class="hidden md:block relative h-[600px] w-full rounded-sm overflow-hidden shadow-2xl transition-all duration-500"
    >
      <img
        :src="
          step === 1
            ? 'https://images.unsplash.com/photo-1517849845537-4d257902454a?q=80&w=1000&auto=format&fit=crop'
            : 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop'
        "
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
      />
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">
      <h1
        class="text-3xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider"
      >
        {{
          step === 1 ? $t('auth.register_owner.title_step1') : $t('auth.register_owner.title_step2')
        }}
      </h1>

      <Message v-if="auth.error" severity="error" class="mb-4">
        {{
          typeof auth.error === 'string' && auth.error.startsWith('errors.')
            ? $t(auth.error)
            : auth.error
        }}
      </Message>

      <form
        v-if="step === 1"
        class="flex flex-col gap-4 animate-fade-in"
        @submit.prevent="nextStep"
      >
        <div class="grid grid-cols-2 gap-4">
          <InputText
            v-model="form.lastname"
            :placeholder="$t('auth.register_owner.fields.lastname')"
            :aria-label="$t('auth.register_owner.fields.lastname')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
            required
          />
          <InputText
            v-model="form.firstname"
            :placeholder="$t('auth.register_owner.fields.firstname')"
            :aria-label="$t('auth.register_owner.fields.firstname')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
            required
          />
        </div>

        <InputText
          v-model="form.email"
          type="email"
          :placeholder="$t('auth.register_owner.fields.email')"
          :aria-label="$t('auth.register_owner.fields.email')"
          class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          required
        />

        <PhoneInput
          v-model="form.phone"
          :aria-label="$t('auth.register_owner.fields.phone')"
        />

        <AddressAutocomplete
          :model-value="form.address"
          :aria-label="$t('auth.register_owner.fields.address')"
          @select="onAddressSelect"
        />

        <div class="grid grid-cols-2 gap-4 items-start">
          <div class="flex flex-col gap-1">
            <Password
              v-model="password"
              :placeholder="$t('auth.register_owner.fields.password')"
              :aria-label="$t('auth.register_owner.fields.password')"
              toggle-mask
              :feedback="false"
              class="w-full"
              input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3"
              :invalid="!isPasswordValid && password.length > 0"
              required
            />
            <small
              v-if="password.length > 0 && !isPasswordValid"
              class="text-red-500 text-[10px] font-bold ml-1"
            >
              {{ $t('errors.password_length') }}
            </small>
          </div>
          <Password
            v-model="confirmPassword"
            :placeholder="$t('auth.register_owner.fields.confirm_password')"
            :aria-label="$t('auth.register_owner.fields.confirm_password')"
            :feedback="false"
            class="w-full"
            input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3"
            required
          />
        </div>

        <div class="flex flex-col gap-2 mt-2">
          <div class="flex items-start gap-2">
            <Checkbox v-model="form.cguAccepted" :binary="true" input-id="reg-owner-cgu" />
            <label for="reg-owner-cgu" class="text-sm cursor-pointer select-none">
              <i18n-t keypath="auth.register_common.consent.cgu" tag="span">
                <template #link>
                  <router-link to="/legal/cgu" target="_blank" class="underline font-semibold">{{
                    $t('auth.register_common.consent.cgu_link')
                  }}</router-link>
                </template>
              </i18n-t>
            </label>
          </div>
          <div class="flex items-start gap-2">
            <Checkbox v-model="form.privacyAccepted" :binary="true" input-id="reg-owner-privacy" />
            <label for="reg-owner-privacy" class="text-sm cursor-pointer select-none">
              <i18n-t keypath="auth.register_common.consent.privacy" tag="span">
                <template #link>
                  <router-link to="/legal/privacy" target="_blank" class="underline font-semibold">{{
                    $t('auth.register_common.consent.privacy_link')
                  }}</router-link>
                </template>
              </i18n-t>
            </label>
          </div>
        </div>

        <Button
          type="submit"
          :label="$t('auth.register_owner.next')"
          class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !mt-4 !rounded-md shadow-lg shadow-red-500/20"
        />
      </form>

      <form v-else class="flex flex-col gap-4 animate-fade-in" @submit.prevent="handleRegister">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputText
            v-model="form.animal_name"
            :placeholder="$t('auth.register_owner.fields.animal_name')"
            :aria-label="$t('auth.register_owner.fields.animal_name')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full"
          />

          <AppDatePicker
            v-model="form.animal_birthDate"
            :placeholder="$t('auth.register_owner.fields.animal_birth_date')"
            :aria-label="$t('auth.register_owner.fields.animal_birth_date')"
            class="w-full"
            input-class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full placeholder:!text-zinc-500"
            :pt="{
              root: { class: 'w-full' },
              input: { class: 'w-full !shadow-none focus:!ring-0' },
              dropdownButton: { class: '!bg-transparent !text-zinc-500 !border-none' },
            }"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <Select
            v-model="form.animal_species"
            :options="speciesOptions"
            option-label="label"
            option-value="value"
            :aria-label="$t('auth.register_owner.fields.animal_species')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full"
          />
          <!-- Correctif hauteur (bug visuel signalé) : `BreedAutocomplete` a `inheritAttrs:
               false` et ne pousse `$attrs.class` que dans `input-class` de l'AutoComplete
               interne -- jamais sur son composant racine, contrairement à `Select`/`InputText`
               (qui la reçoivent directement). Même patron `pt` que `AppDatePicker` juste
               au-dessus dans ce même fichier.
               Vérifié dans le DOM rendu (getComputedStyle, avant/après) : le padding
               (`!p-3`, 12px haut/bas) ET le `line-height` sont déjà IDENTIQUES entre le
               `Select` espèce et l'`<input>` de cet AutoComplete -- la différence de hauteur
               (64px contre 48px) ne vient PAS d'un padding manquant sur l'input, mais du
               thème Aura : `.p-select` a un `<span class="p-select-label">` interne qui
               porte SON PROPRE padding vertical (4px), en plus de celui du conteneur racine
               -- un `<input>` HTML simple n'a pas cet étage supplémentaire. Un second
               `!p-*` sur l'input ne peut donc pas rattraper l'écart (les deux `!p-3` déjà en
               présence -- celui d'`input-class` et celui de la classe passée ici -- entrent
               par ailleurs en concurrence de spécificité imprévisible entre utilitaires
               Tailwind `!important`). `min-height` en `style` (jamais concurrencé par une
               classe existante) est le point d'accroche stable : il aligne la hauteur totale
               sur celle, mesurée, du Select voisin. -->
          <BreedAutocomplete
            v-model="form.animal_breed"
            :species="form.animal_species"
            :aria-label="$t('auth.register_owner.fields.animal_breed')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
            :pt="{
              root: { class: 'w-full' },
              pcInputText: { root: { class: '!shadow-none focus:!ring-0', style: { minHeight: '4rem' } } },
            }"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <InputText
            v-model="form.animal_weight"
            type="number"
            step="0.1"
            :placeholder="$t('auth.register_owner.fields.animal_weight')"
            :aria-label="$t('auth.register_owner.fields.animal_weight')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          />
          <Select
            v-model="form.blood_group"
            :options="bloodOptions"
            :disabled="!form.animal_species"
            :placeholder="$t('auth.register_owner.fields.blood_group')"
            :aria-label="$t('auth.register_owner.fields.blood_group')"
            required
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          >
            <template #value="slotProps">
              <span v-if="slotProps.value">{{
                formatBloodGroupLabel(
                  slotProps.value,
                  $t('dashboard.owner.animals.form.blood_group_unknown_option'),
                )
              }}</span>
              <span v-else>{{ slotProps.placeholder }}</span>
            </template>
            <template #option="slotProps">
              {{
                formatBloodGroupLabel(
                  slotProps.option,
                  $t('dashboard.owner.animals.form.blood_group_unknown_option'),
                )
              }}
            </template>
          </Select>
        </div>

        <Select
          v-model="form.animal_sex"
          :options="sexOptions"
          option-label="label"
          option-value="value"
          :placeholder="$t('auth.register_owner.fields.animal_sex')"
          :aria-label="$t('auth.register_owner.fields.animal_sex')"
          show-clear
          class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full"
        />

        <Select
          v-model="form.animal_donationFrequency"
          :options="frequencyOptions"
          option-label="label"
          option-value="value"
          :aria-label="$t('dashboard.owner.animals.form.donation_frequency')"
          class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full"
        />

        <div class="flex gap-4 p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-md">
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.animal_isVaccinated" :binary="true" input-id="reg-vaccinated" />
            <label for="reg-vaccinated" class="text-sm cursor-pointer select-none">{{
              $t('dashboard.owner.animals.form.vaccinated_required')
            }}</label>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.animal_isSterilized" :binary="true" input-id="reg-sterilized" />
            <label for="reg-sterilized" class="text-sm cursor-pointer select-none">{{
              $t('dashboard.owner.animals.form.sterilized')
            }}</label>
          </div>
        </div>

        <div class="flex gap-4 mt-4">
          <Button
            icon="pi pi-arrow-left"
            class="!bg-zinc-200 dark:!bg-zinc-800 !text-zinc-500 !border-none"
            @click="step = 1"
          />
          <Button
            type="submit"
            :label="$t('auth.register_owner.finish')"
            class="flex-grow !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20"
            :loading="auth.isLoading"
          />
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
