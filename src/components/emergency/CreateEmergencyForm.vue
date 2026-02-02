<template>
  <div class="create-emergency-form">
    <form @submit.prevent="handleSubmit">
      <!-- Niveau d'urgence -->
      <div class="field">
        <label for="urgencyLevel" class="required">Niveau d'urgence</label>
        <SelectButton
          id="urgencyLevel"
          v-model="formData.urgencyLevel"
          :options="urgencyOptions"
          option-label="label"
          option-value="value"
          :invalid="errors.urgencyLevel"
          class="w-full"
        />
        <small v-if="errors.urgencyLevel" class="p-error">{{ errors.urgencyLevel }}</small>
      </div>

      <!-- Type d'urgence -->
      <div class="field">
        <label for="emergencyType" class="required">Type d'urgence</label>
        <Select
          id="emergencyType"
          v-model="formData.type"
          :options="emergencyTypes"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner le type d'urgence"
          :invalid="errors.type"
          class="w-full"
        />
        <small v-if="errors.type" class="p-error">{{ errors.type }}</small>
      </div>

      <!-- Titre -->
      <div class="field">
        <label for="title" class="required">Titre de l'urgence</label>
        <InputText
          id="title"
          v-model="formData.title"
          placeholder="Ex: Transfusion urgente - Chien accidenté"
          :invalid="errors.title"
          class="w-full"
        />
        <small v-if="errors.title" class="p-error">{{ errors.title }}</small>
      </div>

      <!-- Message -->
      <div class="field">
        <label for="message" class="required">Description détaillée</label>
        <Textarea
          id="message"
          v-model="formData.message"
          rows="4"
          placeholder="Décrivez la situation d'urgence en détail..."
          :invalid="errors.message"
          class="w-full"
        />
        <small v-if="errors.message" class="p-error">{{ errors.message }}</small>
      </div>

      <!-- Informations animal -->
      <div class="section-header">
        <h4>Informations sur l'animal</h4>
      </div>

      <div class="field-group">
        <div class="field">
          <label for="animalType">Type d'animal</label>
          <Select
            id="animalType"
            v-model="formData.animalType"
            :options="animalTypes"
            option-label="label"
            option-value="value"
            placeholder="Sélectionner le type"
            class="w-full"
          />
        </div>

        <div class="field">
          <label for="bloodType">Groupe sanguin</label>
          <Select
            id="bloodType"
            v-model="formData.bloodType"
            :options="bloodTypeOptions"
            option-label="label"
            option-value="value"
            placeholder="Sélectionner le groupe"
            :disabled="!formData.animalType"
            class="w-full"
          />
        </div>
      </div>

      <div class="field-group">
        <div class="field">
          <label for="animalWeight">Poids (kg)</label>
          <InputNumber
            id="animalWeight"
            v-model="formData.animalWeight"
            :min="0"
            :max="100"
            :step="0.1"
            placeholder="0.0"
            class="w-full"
          />
        </div>

        <div class="field">
          <label for="animalAge">Âge (années)</label>
          <InputNumber
            id="animalAge"
            v-model="formData.animalAge"
            :min="0"
            :max="30"
            placeholder="0"
            class="w-full"
          />
        </div>
      </div>

      <!-- Localisation -->
      <div class="section-header">
        <h4>Localisation</h4>
      </div>

      <div class="field">
        <label for="clinicId">Clinique</label>
        <Select
          id="clinicId"
          v-model="formData.clinicId"
          :options="clinics"
          option-label="name"
          option-value="id"
          placeholder="Sélectionner la clinique"
          filter
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="location">Adresse complète</label>
        <InputText
          id="location"
          v-model="formData.location"
          placeholder="Ex: 123 Rue de la Paix, 75001 Paris"
          class="w-full"
        />
      </div>

      <!-- Contact d'urgence -->
      <div class="section-header">
        <h4>Contact d'urgence</h4>
      </div>

      <div class="field-group">
        <div class="field">
          <label for="contactPhone" class="required">Téléphone</label>
          <InputText
            id="contactPhone"
            v-model="formData.contactPhone"
            placeholder="01 23 45 67 89"
            :invalid="errors.contactPhone"
            class="w-full"
          />
          <small v-if="errors.contactPhone" class="p-error">{{ errors.contactPhone }}</small>
        </div>

        <div class="field">
          <label for="contactEmail">Email</label>
          <InputText
            id="contactEmail"
            v-model="formData.contactEmail"
            type="email"
            placeholder="urgence@clinique.fr"
            class="w-full"
          />
        </div>
      </div>

      <!-- Temps estimé -->
      <div class="field">
        <label for="estimatedTime">Temps estimé disponible</label>
        <Select
          id="estimatedTime"
          v-model="formData.estimatedTime"
          :options="timeOptions"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner le délai"
          class="w-full"
        />
      </div>

      <!-- Donneurs cibles -->
      <div class="section-header">
        <h4>Donneurs à notifier</h4>
      </div>

      <div class="field">
        <label for="targetUsers">Donneurs principaux</label>
        <MultiSelect
          id="targetUsers"
          v-model="formData.targetUsers"
          :options="availableDonors"
          option-label="name"
          option-value="id"
          placeholder="Sélectionner les donneurs"
          filter
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="fallbackUsers">Donneurs de secours</label>
        <MultiSelect
          id="fallbackUsers"
          v-model="formData.fallbackUsers"
          :options="availableDonors"
          option-label="name"
          option-value="id"
          placeholder="Sélectionner les donneurs de secours"
          filter
          class="w-full"
        />
      </div>

      <!-- Options avancées -->
      <div class="section-header">
        <h4>Options avancées</h4>
      </div>

      <div class="field">
        <div class="flex align-items-center">
          <Checkbox id="requiresAcknowledgment" v-model="formData.requiresAcknowledgment" binary />
          <label for="requiresAcknowledgment" class="ml-2">Accusé de réception requis</label>
        </div>
      </div>

      <div class="field">
        <label for="expiresIn">Expiration de l'urgence</label>
        <Select
          id="expiresIn"
          v-model="formData.expiresIn"
          :options="expirationOptions"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner la durée"
          class="w-full"
        />
      </div>

      <!-- Aperçu de l'urgence -->
      <div v-if="showPreview" class="emergency-preview">
        <div class="preview-header">
          <h4>Aperçu de l'urgence</h4>
          <Button icon="pi pi-eye-slash" size="small" text rounded @click="showPreview = false" />
        </div>
        <div class="preview-content">
          <div class="preview-urgency">
            <Tag
              :value="getUrgencyLabel(formData.urgencyLevel)"
              :severity="getUrgencySeverity(formData.urgencyLevel)"
            />
          </div>
          <h5>{{ formData.title || "Titre de l'urgence" }}</h5>
          <p>{{ formData.message || "Description de l'urgence" }}</p>
          <div class="preview-details">
            <div v-if="formData.animalType" class="detail-item">
              <i class="pi pi-heart"></i>
              <span>{{ getAnimalTypeLabel(formData.animalType) }}</span>
            </div>
            <div v-if="formData.bloodType" class="detail-item">
              <i class="pi pi-circle"></i>
              <span>{{ getBloodTypeLabel(formData.bloodType) }}</span>
            </div>
            <div v-if="formData.location" class="detail-item">
              <i class="pi pi-map-marker"></i>
              <span>{{ formData.location }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="form-actions">
        <Button label="Aperçu" icon="pi pi-eye" outlined @click="showPreview = !showPreview" />
        <Button label="Annuler" severity="secondary" outlined @click="$emit('cancel')" />
        <Button
          label="Créer l'urgence"
          icon="pi pi-exclamation-triangle"
          severity="danger"
          type="submit"
          :loading="isSubmitting"
          :disabled="!isFormValid"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useEmergencyNotifications } from '@/composables/useEmergencyNotifications'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import MultiSelect from 'primevue/multiselect'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

const emit = defineEmits(['created', 'cancel'])

const { sendEmergencyNotification } = useEmergencyNotifications()

// États
const isSubmitting = ref(false)
const showPreview = ref(false)
const errors = ref({})

// Données du formulaire
const formData = ref({
  urgencyLevel: 'CRITICAL',
  type: 'EMERGENCY_ALERT',
  title: '',
  message: '',
  animalType: '',
  bloodType: '',
  animalWeight: null,
  animalAge: null,
  clinicId: '',
  location: '',
  contactPhone: '',
  contactEmail: '',
  estimatedTime: '30min',
  targetUsers: [],
  fallbackUsers: [],
  requiresAcknowledgment: true,
  expiresIn: '4h',
})

// Options
const urgencyOptions = [
  { label: 'Critique', value: 'CRITICAL', icon: 'pi pi-exclamation-triangle' },
  { label: 'Urgent', value: 'URGENT', icon: 'pi pi-exclamation-circle' },
  { label: 'Élevé', value: 'HIGH', icon: 'pi pi-info-circle' },
]

const emergencyTypes = [
  { label: "Alerte d'urgence", value: 'EMERGENCY_ALERT' },
  { label: 'Nouveau match trouvé', value: 'NEW_MATCH' },
  { label: 'Donneur de secours requis', value: 'FALLBACK_EMERGENCY_ALERT' },
  { label: 'Alerte système', value: 'SYSTEM_ALERT' },
]

const animalTypes = [
  { label: 'Chien', value: 'dog' },
  { label: 'Chat', value: 'cat' },
  { label: 'Lapin', value: 'rabbit' },
  { label: 'Furet', value: 'ferret' },
  { label: 'Autre', value: 'other' },
]

const timeOptions = [
  { label: '15 minutes', value: '15min' },
  { label: '30 minutes', value: '30min' },
  { label: '1 heure', value: '1h' },
  { label: '2 heures', value: '2h' },
  { label: '4 heures', value: '4h' },
  { label: '8 heures', value: '8h' },
]

const expirationOptions = [
  { label: '2 heures', value: '2h' },
  { label: '4 heures', value: '4h' },
  { label: '8 heures', value: '8h' },
  { label: '12 heures', value: '12h' },
  { label: '24 heures', value: '24h' },
]

// Données simulées (à remplacer par de vraies données)
const clinics = ref([
  { id: 'clinic-1', name: 'Clinique Vétérinaire Paris Centre' },
  { id: 'clinic-2', name: 'Hôpital Vétérinaire de Neuilly' },
  { id: 'clinic-3', name: 'Clinique des Animaux de Compagnie' },
])

const availableDonors = ref([
  { id: 'donor-1', name: 'Max (Chien, DEA 1.1+)' },
  { id: 'donor-2', name: 'Luna (Chat, Type A)' },
  { id: 'donor-3', name: 'Rex (Chien, DEA 1.1-)' },
  { id: 'donor-4', name: 'Mimi (Chat, Type B)' },
])

// Propriétés calculées
const bloodTypeOptions = computed(() => {
  if (formData.value.animalType === 'dog') {
    return [
      { label: 'DEA 1.1+', value: 'DEA_1_1_POS' },
      { label: 'DEA 1.1-', value: 'DEA_1_1_NEG' },
      { label: 'DEA 3+', value: 'DEA_3_POS' },
      { label: 'DEA 3-', value: 'DEA_3_NEG' },
      { label: 'DEA 5+', value: 'DEA_5_POS' },
      { label: 'DEA 5-', value: 'DEA_5_NEG' },
    ]
  } else if (formData.value.animalType === 'cat') {
    return [
      { label: 'Type A', value: 'TYPE_A' },
      { label: 'Type B', value: 'TYPE_B' },
      { label: 'Type AB', value: 'TYPE_AB' },
    ]
  }
  return []
})

const isFormValid = computed(() => {
  return (
    formData.value.urgencyLevel &&
    formData.value.type &&
    formData.value.title.trim() &&
    formData.value.message.trim() &&
    formData.value.contactPhone.trim() &&
    Object.keys(errors.value).length === 0
  )
})

// Validation
const validateForm = () => {
  errors.value = {}

  if (!formData.value.urgencyLevel) {
    errors.value.urgencyLevel = "Le niveau d'urgence est requis"
  }

  if (!formData.value.type) {
    errors.value.type = "Le type d'urgence est requis"
  }

  if (!formData.value.title.trim()) {
    errors.value.title = 'Le titre est requis'
  } else if (formData.value.title.length < 10) {
    errors.value.title = 'Le titre doit contenir au moins 10 caractères'
  }

  if (!formData.value.message.trim()) {
    errors.value.message = 'La description est requise'
  } else if (formData.value.message.length < 20) {
    errors.value.message = 'La description doit contenir au moins 20 caractères'
  }

  if (!formData.value.contactPhone.trim()) {
    errors.value.contactPhone = 'Le téléphone de contact est requis'
  } else if (!/^[\d\s\-\+\(\)\.]{10,}$/.test(formData.value.contactPhone)) {
    errors.value.contactPhone = 'Format de téléphone invalide'
  }

  return Object.keys(errors.value).length === 0
}

// Méthodes
const handleSubmit = async () => {
  if (!validateForm()) {
    return
  }

  try {
    isSubmitting.value = true

    // Préparer les données d'urgence
    const emergencyData = {
      urgencyLevel: formData.value.urgencyLevel,
      type: formData.value.type,
      title: formData.value.title,
      message: formData.value.message,
      animalType: getAnimalTypeLabel(formData.value.animalType),
      bloodType: getBloodTypeLabel(formData.value.bloodType),
      location: formData.value.location,
      estimatedTime: formData.value.estimatedTime,
      targetUsers: formData.value.targetUsers,
      fallbackUsers: formData.value.fallbackUsers,
      requiresAcknowledgment: formData.value.requiresAcknowledgment,
      contactInfo: {
        phone: formData.value.contactPhone,
        email: formData.value.contactEmail,
      },
      expiresAt: Date.now() + parseExpirationTime(formData.value.expiresIn),
      missionId: generateMissionId(),
      clinicId: formData.value.clinicId,
    }

    const result = await sendEmergencyNotification(emergencyData)

    console.log('✅ Urgence créée avec succès:', result)

    emit('created', {
      ...emergencyData,
      id: result.emergencyId,
    })

    // Réinitialiser le formulaire
    resetForm()
  } catch (error) {
    console.error('❌ Erreur création urgence:', error)
    // TODO: Afficher un message d'erreur à l'utilisateur
  } finally {
    isSubmitting.value = false
  }
}

const resetForm = () => {
  formData.value = {
    urgencyLevel: 'CRITICAL',
    type: 'EMERGENCY_ALERT',
    title: '',
    message: '',
    animalType: '',
    bloodType: '',
    animalWeight: null,
    animalAge: null,
    clinicId: '',
    location: '',
    contactPhone: '',
    contactEmail: '',
    estimatedTime: '30min',
    targetUsers: [],
    fallbackUsers: [],
    requiresAcknowledgment: true,
    expiresIn: '4h',
  }
  errors.value = {}
  showPreview.value = false
}

// Utilitaires
const getUrgencyLabel = (level) => {
  const option = urgencyOptions.find((opt) => opt.value === level)
  return option?.label || level
}

const getUrgencySeverity = (level) => {
  const severities = {
    CRITICAL: 'danger',
    URGENT: 'warning',
    HIGH: 'info',
  }
  return severities[level] || 'info'
}

const getAnimalTypeLabel = (type) => {
  const option = animalTypes.find((opt) => opt.value === type)
  return option?.label || type
}

const getBloodTypeLabel = (type) => {
  const option = bloodTypeOptions.value.find((opt) => opt.value === type)
  return option?.label || type
}

const parseExpirationTime = (timeStr) => {
  const value = parseInt(timeStr)
  if (timeStr.includes('h')) {
    return value * 60 * 60 * 1000 // heures en millisecondes
  }
  return value * 60 * 1000 // minutes en millisecondes
}

const generateMissionId = () => {
  return `mission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Watchers
watch(
  () => formData.value.animalType,
  () => {
    formData.value.bloodType = ''
  },
)

watch(
  [() => formData.value.title, () => formData.value.message, () => formData.value.contactPhone],
  () => {
    // Validation en temps réel
    if (Object.keys(errors.value).length > 0) {
      validateForm()
    }
  },
)
</script>

<style scoped>
.create-emergency-form {
  max-width: 800px;
  margin: 0 auto;
}

.field {
  margin-bottom: 1.5rem;
}

.field label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: var(--text-color);
}

.field label.required::after {
  content: ' *';
  color: var(--red-500);
}

.field-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.section-header {
  margin: 2rem 0 1rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--surface-border);
}

.section-header h4 {
  margin: 0;
  color: var(--primary-color);
  font-size: 1.125rem;
}

/* Aperçu */
.emergency-preview {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--surface-50);
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.preview-header h4 {
  margin: 0;
  color: var(--primary-color);
}

.preview-content {
  background: var(--surface-card);
  padding: 1rem;
  border-radius: 6px;
}

.preview-urgency {
  margin-bottom: 0.5rem;
}

.preview-content h5 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.preview-content p {
  margin: 0 0 1rem 0;
  color: var(--text-color-secondary);
  line-height: 1.5;
}

.preview-details {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.detail-item i {
  color: var(--primary-color);
}

/* Actions */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--surface-border);
}

/* Responsive */
@media (max-width: 768px) {
  .field-group {
    grid-template-columns: 1fr;
  }

  .form-actions {
    flex-direction: column-reverse;
  }

  .preview-details {
    flex-direction: column;
    gap: 0.5rem;
  }
}

/* Validation */
.p-error {
  color: var(--red-500);
  font-size: 0.875rem;
}

.p-invalid {
  border-color: var(--red-500);
}

/* SelectButton personnalisé pour l'urgence */
:deep(.p-selectbutton .p-button) {
  border-radius: 6px;
}

:deep(.p-selectbutton .p-button.p-highlight) {
  background: var(--red-500);
  border-color: var(--red-500);
}

:deep(.p-selectbutton .p-button.p-highlight:hover) {
  background: var(--red-600);
  border-color: var(--red-600);
}
</style>
