<template>
  <div class="notification-settings">
    <div class="settings-content">
      <!-- Canaux de notification -->
      <div class="settings-section">
        <h4 class="section-title">
          <i class="pi pi-send"></i>
          Canaux de notification
        </h4>
        <p class="section-description">
          Choisissez comment vous souhaitez recevoir les notifications
        </p>

        <div class="settings-grid">
          <div class="setting-item">
            <div class="setting-header">
              <i class="pi pi-desktop setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">Notifications web</label>
                <span class="setting-desc">Notifications en temps réel dans l'application</span>
              </div>
            </div>
            <InputSwitch v-model="preferences.channels.websocket" />
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <i class="pi pi-bell setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">Notifications push</label>
                <span class="setting-desc"
                  >Notifications du navigateur même quand l'app est fermée</span
                >
              </div>
            </div>
            <InputSwitch
              v-model="preferences.channels.push"
              :disabled="!pushSupported"
              @change="handlePushToggle"
            />
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <i class="pi pi-mobile setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">SMS</label>
                <span class="setting-desc">Messages texte pour les urgences importantes</span>
              </div>
            </div>
            <InputSwitch v-model="preferences.channels.sms" />
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <i class="pi pi-envelope setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">Email</label>
                <span class="setting-desc">Emails pour les résumés et alertes importantes</span>
              </div>
            </div>
            <InputSwitch v-model="preferences.channels.email" />
          </div>
        </div>
      </div>

      <!-- Horaires -->
      <div class="settings-section">
        <h4 class="section-title">
          <i class="pi pi-clock"></i>
          Horaires de notification
        </h4>
        <p class="section-description">
          Configurez vos heures de disponibilité pour les notifications
        </p>

        <div class="settings-grid">
          <div class="setting-item full-width">
            <div class="setting-header">
              <i class="pi pi-moon setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">Heures silencieuses</label>
                <span class="setting-desc"
                  >Pas de notifications pendant ces heures (sauf urgences critiques)</span
                >
              </div>
            </div>
            <InputSwitch v-model="preferences.schedule.quietHours.enabled" />
          </div>

          <div v-if="preferences.schedule.quietHours.enabled" class="quiet-hours-config">
            <div class="time-range">
              <div class="time-input">
                <label>Début</label>
                <Calendar
                  v-model="quietHoursStart"
                  time-only
                  hour-format="24"
                  @date-select="updateQuietHoursStart"
                />
              </div>
              <div class="time-input">
                <label>Fin</label>
                <Calendar
                  v-model="quietHoursEnd"
                  time-only
                  hour-format="24"
                  @date-select="updateQuietHoursEnd"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">Autoriser les urgences critiques</label>
                <span class="setting-desc"
                  >Les alertes d'urgence passent même pendant les heures silencieuses</span
                >
              </div>
              <InputSwitch v-model="preferences.schedule.quietHours.exceptEmergency" />
            </div>
          </div>

          <div class="setting-item full-width">
            <div class="setting-info">
              <label class="setting-label">Jours de repos</label>
              <span class="setting-desc"
                >Jours où vous ne souhaitez pas recevoir de notifications (sauf urgences)</span
              >
            </div>
            <MultiSelect
              v-model="preferences.schedule.daysOff"
              :options="daysOfWeek"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner les jours"
              class="days-select"
            />
          </div>
        </div>
      </div>

      <!-- Filtres -->
      <div class="settings-section">
        <h4 class="section-title">
          <i class="pi pi-filter"></i>
          Filtres de notification
        </h4>
        <p class="section-description">
          Personnalisez les types de notifications que vous souhaitez recevoir
        </p>

        <div class="settings-grid">
          <div class="setting-item full-width">
            <div class="setting-info">
              <label class="setting-label">Priorité minimale</label>
              <span class="setting-desc"
                >Ne recevoir que les notifications de cette priorité ou plus élevée</span
              >
            </div>
            <Dropdown
              v-model="preferences.filters.minPriority"
              :options="priorityOptions"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner la priorité"
            />
          </div>

          <div class="setting-item full-width">
            <div class="setting-info">
              <label class="setting-label">Types de notifications</label>
              <span class="setting-desc">Choisissez les types de notifications à recevoir</span>
            </div>
            <MultiSelect
              v-model="preferences.filters.types"
              :options="notificationTypes"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner les types"
              class="types-select"
            />
          </div>

          <div class="setting-item full-width">
            <div class="setting-info">
              <label class="setting-label">Distance maximale (km)</label>
              <span class="setting-desc"
                >Ne recevoir que les notifications pour les missions dans ce rayon</span
              >
            </div>
            <div class="distance-input">
              <InputNumber
                v-model="preferences.filters.maxDistance"
                :min="1"
                :max="200"
                suffix=" km"
                placeholder="Illimitée"
              />
              <Button
                v-tooltip="'Supprimer la limite'"
                icon="pi pi-times"
                size="small"
                text
                rounded
                @click="preferences.filters.maxDistance = null"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Sons et vibrations -->
      <div class="settings-section">
        <h4 class="section-title">
          <i class="pi pi-volume-up"></i>
          Sons et vibrations
        </h4>
        <p class="section-description">Configurez les alertes sonores et les vibrations</p>

        <div class="settings-grid">
          <div class="setting-item full-width">
            <div class="setting-header">
              <i class="pi pi-volume-up setting-icon"></i>
              <div class="setting-info">
                <label class="setting-label">Sons activés</label>
                <span class="setting-desc"
                  >Jouer des sons lors de la réception de notifications</span
                >
              </div>
            </div>
            <InputSwitch v-model="preferences.sounds.enabled" />
          </div>

          <div v-if="preferences.sounds.enabled" class="sound-config">
            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">Son d'urgence</label>
                <span class="setting-desc">Pour les notifications critiques</span>
              </div>
              <div class="sound-selector">
                <Dropdown
                  v-model="preferences.sounds.emergency"
                  :options="soundOptions"
                  option-label="label"
                  option-value="value"
                />
                <Button
                  v-tooltip="'Tester le son'"
                  icon="pi pi-play"
                  size="small"
                  outlined
                  @click="playSound('emergency')"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">Son d'alerte</label>
                <span class="setting-desc">Pour les notifications importantes</span>
              </div>
              <div class="sound-selector">
                <Dropdown
                  v-model="preferences.sounds.alert"
                  :options="soundOptions"
                  option-label="label"
                  option-value="value"
                />
                <Button
                  v-tooltip="'Tester le son'"
                  icon="pi pi-play"
                  size="small"
                  outlined
                  @click="playSound('alert')"
                />
              </div>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label class="setting-label">Son de notification</label>
                <span class="setting-desc">Pour les notifications normales</span>
              </div>
              <div class="sound-selector">
                <Dropdown
                  v-model="preferences.sounds.notification"
                  :options="soundOptions"
                  option-label="label"
                  option-value="value"
                />
                <Button
                  v-tooltip="'Tester le son'"
                  icon="pi pi-play"
                  size="small"
                  outlined
                  @click="playSound('notification')"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="settings-actions">
      <Button label="Réinitialiser" severity="secondary" outlined @click="resetToDefaults" />
      <Button label="Tester les notifications" outlined @click="sendTestNotification" />
      <Button label="Enregistrer" :loading="isSaving" @click="savePreferences" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useNotifications } from '@/composables/useNotifications'
import InputSwitch from 'primevue/inputswitch'
import Calendar from 'primevue/calendar'
import Dropdown from 'primevue/dropdown'
import MultiSelect from 'primevue/multiselect'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'

const emit = defineEmits(['close', 'saved'])

const { notificationService, sendNotification, requestPermission, playSound } = useNotifications()

// États
const isSaving = ref(false)
const pushSupported = ref('Notification' in window)

// Préférences (copie locale pour édition)
const preferences = ref({
  channels: {
    websocket: true,
    push: true,
    sms: true,
    email: true,
  },
  schedule: {
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '07:00',
      exceptEmergency: true,
    },
    daysOff: [],
  },
  filters: {
    minPriority: 'NORMAL',
    types: ['NEW_MATCH', 'DONOR_ACCEPTED', 'EMERGENCY_ALERT'],
    maxDistance: null,
  },
  sounds: {
    enabled: true,
    emergency: 'siren',
    alert: 'bell',
    notification: 'chime',
  },
})

// Données pour les heures silencieuses
const quietHoursStart = ref(new Date())
const quietHoursEnd = ref(new Date())

// Options
const daysOfWeek = [
  { label: 'Lundi', value: 'monday' },
  { label: 'Mardi', value: 'tuesday' },
  { label: 'Mercredi', value: 'wednesday' },
  { label: 'Jeudi', value: 'thursday' },
  { label: 'Vendredi', value: 'friday' },
  { label: 'Samedi', value: 'saturday' },
  { label: 'Dimanche', value: 'sunday' },
]

const priorityOptions = [
  { label: 'Toutes', value: 'LOW' },
  { label: 'Normale et plus', value: 'NORMAL' },
  { label: 'Élevée et plus', value: 'HIGH' },
  { label: 'Critique uniquement', value: 'CRITICAL' },
]

const notificationTypes = [
  { label: 'Nouveau match', value: 'NEW_MATCH' },
  { label: 'Donneur accepté', value: 'DONOR_ACCEPTED' },
  { label: 'Donneur refusé', value: 'DONOR_DECLINED' },
  { label: 'Donneur en route', value: 'DONOR_EN_ROUTE' },
  { label: 'Donneur arrivé', value: 'DONOR_ARRIVED' },
  { label: 'Transfusion démarrée', value: 'TRANSFUSION_STARTED' },
  { label: 'Transfusion terminée', value: 'TRANSFUSION_COMPLETED' },
  { label: 'Mission annulée', value: 'MISSION_CANCELLED' },
  { label: "Alerte d'urgence", value: 'EMERGENCY_ALERT' },
  { label: 'Rappels', value: 'REMINDER' },
  { label: 'Alertes système', value: 'SYSTEM_ALERT' },
]

const soundOptions = [
  { label: 'Sirène', value: 'siren' },
  { label: 'Cloche', value: 'bell' },
  { label: 'Carillon', value: 'chime' },
  { label: 'Bip', value: 'beep' },
  { label: 'Aucun', value: 'none' },
]

// Méthodes
const loadPreferences = async () => {
  try {
    // Charger les préférences depuis le service
    const defaultPrefs = notificationService.defaultPreferences
    preferences.value = { ...defaultPrefs }

    // Initialiser les heures silencieuses
    updateQuietHoursInputs()

    console.log('✅ Préférences chargées')
  } catch (error) {
    console.error('Erreur chargement préférences:', error)
  }
}

const savePreferences = async () => {
  try {
    isSaving.value = true

    // Simuler la sauvegarde
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Ici on sauvegarderait en base de données
    console.log('💾 Préférences sauvegardées:', preferences.value)

    emit('saved', preferences.value)
    emit('close')
  } catch (error) {
    console.error('Erreur sauvegarde préférences:', error)
  } finally {
    isSaving.value = false
  }
}

const resetToDefaults = () => {
  preferences.value = { ...notificationService.defaultPreferences }
  updateQuietHoursInputs()
  console.log('🔄 Préférences réinitialisées')
}

const handlePushToggle = async (enabled) => {
  if (enabled) {
    try {
      await requestPermission()
      console.log('✅ Permission push accordée')
    } catch (error) {
      console.error('❌ Permission push refusée:', error)
      preferences.value.channels.push = false
    }
  }
}

const updateQuietHoursStart = (date) => {
  const time = date.toTimeString().slice(0, 5)
  preferences.value.schedule.quietHours.start = time
}

const updateQuietHoursEnd = (date) => {
  const time = date.toTimeString().slice(0, 5)
  preferences.value.schedule.quietHours.end = time
}

const updateQuietHoursInputs = () => {
  const [startHour, startMin] = preferences.value.schedule.quietHours.start.split(':')
  const [endHour, endMin] = preferences.value.schedule.quietHours.end.split(':')

  quietHoursStart.value = new Date()
  quietHoursStart.value.setHours(parseInt(startHour), parseInt(startMin), 0, 0)

  quietHoursEnd.value = new Date()
  quietHoursEnd.value.setHours(parseInt(endHour), parseInt(endMin), 0, 0)
}

const sendTestNotification = async () => {
  try {
    await sendNotification({
      type: 'SYSTEM_ALERT',
      title: 'Test de notification',
      message: 'Ceci est une notification de test pour vérifier vos paramètres.',
      priority: 'NORMAL',
    })

    console.log('📧 Notification de test envoyée')
  } catch (error) {
    console.error('Erreur envoi test:', error)
  }
}

// Lifecycle
onMounted(() => {
  loadPreferences()
})
</script>

<style scoped>
.notification-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-height: 70vh;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding-right: 0.5rem;
}

/* Sections */
.settings-section {
  margin-bottom: 2rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem 0;
  color: var(--primary-color);
  font-size: 1.1rem;
}

.section-description {
  margin: 0 0 1rem 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

/* Grille des paramètres */
.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 8px;
  gap: 1rem;
}

.setting-item.full-width {
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
}

.setting-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.setting-icon {
  color: var(--primary-color);
  font-size: 1.25rem;
}

.setting-info {
  flex: 1;
}

.setting-label {
  display: block;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 0.25rem;
}

.setting-desc {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  line-height: 1.3;
}

/* Configuration spécifique */
.quiet-hours-config {
  margin-top: 1rem;
  padding: 1rem;
  background: var(--surface-100);
  border-radius: 8px;
}

.time-range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.time-input label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-color);
}

.sound-config {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sound-selector {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.distance-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.days-select,
.types-select {
  width: 100%;
}

/* Actions */
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-border);
}

/* Responsive */
@media (max-width: 768px) {
  .notification-settings {
    max-height: 80vh;
  }

  .setting-item {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .setting-header {
    justify-content: flex-start;
  }

  .time-range {
    grid-template-columns: 1fr;
  }

  .settings-actions {
    flex-direction: column;
  }

  .sound-selector {
    flex-direction: column;
    align-items: stretch;
  }
}

/* Scrollbar */
.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: var(--surface-100);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: var(--surface-400);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: var(--surface-500);
}
</style>
