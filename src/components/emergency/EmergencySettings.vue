<template>
  <div class="emergency-settings">
    <!-- Paramètres de notification -->
    <div class="settings-section">
      <div class="section-header">
        <h4>
          <i class="pi pi-bell"></i>
          Paramètres de notification
        </h4>
        <p>Configurez comment vous souhaitez recevoir les notifications d'urgence</p>
      </div>

      <div class="settings-grid">
        <!-- Canaux de notification -->
        <div class="setting-group">
          <h5>Canaux de notification</h5>
          <div class="channel-options">
            <div class="channel-option">
              <div class="channel-info">
                <i class="pi pi-desktop channel-icon"></i>
                <div class="channel-details">
                  <span class="channel-name">Notifications Web</span>
                  <small>Notifications en temps réel dans l'application</small>
                </div>
              </div>
              <ToggleSwitch v-model="settings.channels.websocket" />
            </div>

            <div class="channel-option">
              <div class="channel-info">
                <i class="pi pi-mobile channel-icon"></i>
                <div class="channel-details">
                  <span class="channel-name">Notifications Push</span>
                  <small>Notifications sur votre appareil mobile</small>
                </div>
              </div>
              <ToggleSwitch v-model="settings.channels.push" />
            </div>

            <div class="channel-option">
              <div class="channel-info">
                <i class="pi pi-phone channel-icon"></i>
                <div class="channel-details">
                  <span class="channel-name">SMS</span>
                  <small>Messages texte pour les urgences critiques</small>
                </div>
              </div>
              <ToggleSwitch v-model="settings.channels.sms" />
            </div>

            <div class="channel-option">
              <div class="channel-info">
                <i class="pi pi-envelope channel-icon"></i>
                <div class="channel-details">
                  <span class="channel-name">Email</span>
                  <small>Notifications par email en dernier recours</small>
                </div>
              </div>
              <ToggleSwitch v-model="settings.channels.email" />
            </div>
          </div>
        </div>

        <!-- Niveaux d'urgence -->
        <div class="setting-group">
          <h5>Niveaux d'urgence</h5>
          <div class="urgency-settings">
            <div class="urgency-option">
              <div class="urgency-info">
                <Tag value="Critique" severity="danger" />
                <span>Urgences vitales nécessitant une intervention immédiate</span>
              </div>
              <ToggleSwitch v-model="settings.urgencyLevels.critical" />
            </div>

            <div class="urgency-option">
              <div class="urgency-info">
                <Tag value="Urgent" severity="warning" />
                <span>Situations urgentes mais non critiques</span>
              </div>
              <ToggleSwitch v-model="settings.urgencyLevels.urgent" />
            </div>

            <div class="urgency-option">
              <div class="urgency-info">
                <Tag value="Élevé" severity="info" />
                <span>Situations importantes nécessitant attention</span>
              </div>
              <ToggleSwitch v-model="settings.urgencyLevels.high" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Horaires de disponibilité -->
    <div class="settings-section">
      <div class="section-header">
        <h4>
          <i class="pi pi-clock"></i>
          Horaires de disponibilité
        </h4>
        <p>Définissez vos heures de disponibilité pour les notifications d'urgence</p>
      </div>

      <div class="availability-settings">
        <div class="quiet-hours">
          <div class="setting-header">
            <div class="setting-info">
              <h5>Heures silencieuses</h5>
              <p>Période pendant laquelle les notifications non critiques sont désactivées</p>
            </div>
            <ToggleSwitch v-model="settings.schedule.quietHours.enabled" />
          </div>

          <div v-if="settings.schedule.quietHours.enabled" class="quiet-hours-config">
            <div class="time-range">
              <div class="field">
                <label>Début</label>
                <Calendar
                  v-model="quietHoursStart"
                  time-only
                  hour-format="24"
                  placeholder="22:00"
                />
              </div>
              <div class="field">
                <label>Fin</label>
                <Calendar v-model="quietHoursEnd" time-only hour-format="24" placeholder="07:00" />
              </div>
            </div>

            <div class="exception-setting">
              <Checkbox
                id="exceptEmergency"
                v-model="settings.schedule.quietHours.exceptEmergency"
                binary
              />
              <label for="exceptEmergency"
                >Autoriser les urgences critiques pendant les heures silencieuses</label
              >
            </div>
          </div>
        </div>

        <div class="days-off">
          <h5>Jours d'indisponibilité</h5>
          <p>Sélectionnez les jours où vous n'êtes pas disponible pour les missions</p>
          <div class="days-selection">
            <div
              v-for="day in daysOfWeek"
              :key="day.value"
              class="day-option"
              :class="{ selected: settings.schedule.daysOff.includes(day.value) }"
              @click="toggleDayOff(day.value)"
            >
              <span>{{ day.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Filtres et préférences -->
    <div class="settings-section">
      <div class="section-header">
        <h4>
          <i class="pi pi-filter"></i>
          Filtres et préférences
        </h4>
        <p>Personnalisez les types de notifications que vous souhaitez recevoir</p>
      </div>

      <div class="filter-settings">
        <div class="setting-group">
          <h5>Types d'animaux</h5>
          <div class="animal-filters">
            <div v-for="animal in animalTypes" :key="animal.value" class="filter-option">
              <Checkbox
                :id="`animal-${animal.value}`"
                v-model="settings.filters.animalTypes"
                :value="animal.value"
              />
              <label :for="`animal-${animal.value}`">{{ animal.label }}</label>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <h5>Distance maximale</h5>
          <div class="distance-setting">
            <Slider
              v-model="settings.filters.maxDistance"
              :min="5"
              :max="100"
              :step="5"
              class="distance-slider"
            />
            <div class="distance-display">
              <span>{{ settings.filters.maxDistance }} km</span>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <h5>Types de notifications</h5>
          <div class="notification-types">
            <div v-for="type in notificationTypes" :key="type.value" class="filter-option">
              <Checkbox
                :id="`type-${type.value}`"
                v-model="settings.filters.notificationTypes"
                :value="type.value"
              />
              <label :for="`type-${type.value}`">{{ type.label }}</label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Paramètres audio -->
    <div class="settings-section">
      <div class="section-header">
        <h4>
          <i class="pi pi-volume-up"></i>
          Paramètres audio
        </h4>
        <p>Configurez les sons et alertes pour les notifications d'urgence</p>
      </div>

      <div class="audio-settings">
        <div class="setting-header">
          <div class="setting-info">
            <h5>Sons activés</h5>
            <p>Jouer des sons pour les notifications d'urgence</p>
          </div>
          <ToggleSwitch v-model="settings.sounds.enabled" />
        </div>

        <div v-if="settings.sounds.enabled" class="sound-options">
          <div class="sound-setting">
            <label>Son d'urgence critique</label>
            <div class="sound-selector">
              <Select
                v-model="settings.sounds.emergency"
                :options="emergencySounds"
                option-label="label"
                option-value="value"
                placeholder="Sélectionner un son"
              />
              <Button
                icon="pi pi-play"
                size="small"
                outlined
                @click="playSound(settings.sounds.emergency)"
              />
            </div>
          </div>

          <div class="sound-setting">
            <label>Son d'alerte</label>
            <div class="sound-selector">
              <Select
                v-model="settings.sounds.alert"
                :options="alertSounds"
                option-label="label"
                option-value="value"
                placeholder="Sélectionner un son"
              />
              <Button
                icon="pi pi-play"
                size="small"
                outlined
                @click="playSound(settings.sounds.alert)"
              />
            </div>
          </div>

          <div class="sound-setting">
            <label>Son de notification</label>
            <div class="sound-selector">
              <Select
                v-model="settings.sounds.notification"
                :options="notificationSounds"
                option-label="label"
                option-value="value"
                placeholder="Sélectionner un son"
              />
              <Button
                icon="pi pi-play"
                size="small"
                outlined
                @click="playSound(settings.sounds.notification)"
              />
            </div>
          </div>

          <div class="volume-setting">
            <label>Volume</label>
            <div class="volume-control">
              <Slider
                v-model="settings.sounds.volume"
                :min="0"
                :max="100"
                :step="5"
                class="volume-slider"
              />
              <span class="volume-display">{{ settings.sounds.volume }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="settings-actions">
      <Button
        label="Réinitialiser"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        @click="resetSettings"
      />
      <Button
        label="Tester les notifications"
        icon="pi pi-play"
        severity="warning"
        outlined
        @click="testNotifications"
      />
      <Button
        label="Enregistrer"
        icon="pi pi-check"
        severity="success"
        :loading="isSaving"
        @click="saveSettings"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useEmergencyNotifications } from '@/composables/useEmergencyNotifications'
import ToggleSwitch from 'primevue/toggleswitch'
import Calendar from 'primevue/calendar'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

const emit = defineEmits(['close'])

const { sendEmergencyNotification } = useEmergencyNotifications()

// États
const isSaving = ref(false)

// Paramètres par défaut
const defaultSettings = {
  channels: {
    websocket: true,
    push: true,
    sms: true,
    email: true,
  },
  urgencyLevels: {
    critical: true,
    urgent: true,
    high: true,
  },
  schedule: {
    quietHours: {
      enabled: true,
      start: '22:00',
      end: '07:00',
      exceptEmergency: true,
    },
    daysOff: [],
  },
  filters: {
    animalTypes: ['dog', 'cat'],
    maxDistance: 50,
    notificationTypes: ['NEW_MATCH', 'EMERGENCY_ALERT', 'MISSION_UPDATE'],
  },
  sounds: {
    enabled: true,
    emergency: 'emergency-siren',
    alert: 'urgent-alarm',
    notification: 'notification-chime',
    volume: 80,
  },
}

// Paramètres actuels
const settings = ref({ ...defaultSettings })

// Heures silencieuses (objets Date pour le composant Calendar)
const quietHoursStart = ref(new Date())
const quietHoursEnd = ref(new Date())

// Options
const daysOfWeek = [
  { label: 'Lun', value: 'monday' },
  { label: 'Mar', value: 'tuesday' },
  { label: 'Mer', value: 'wednesday' },
  { label: 'Jeu', value: 'thursday' },
  { label: 'Ven', value: 'friday' },
  { label: 'Sam', value: 'saturday' },
  { label: 'Dim', value: 'sunday' },
]

const animalTypes = [
  { label: 'Chiens', value: 'dog' },
  { label: 'Chats', value: 'cat' },
  { label: 'Lapins', value: 'rabbit' },
  { label: 'Furets', value: 'ferret' },
  { label: 'Autres', value: 'other' },
]

const notificationTypes = [
  { label: 'Nouveaux matchs', value: 'NEW_MATCH' },
  { label: "Alertes d'urgence", value: 'EMERGENCY_ALERT' },
  { label: 'Mises à jour de mission', value: 'MISSION_UPDATE' },
  { label: 'Rappels', value: 'REMINDER' },
  { label: 'Confirmations', value: 'CONFIRMATION' },
]

const emergencySounds = [
  { label: "Sirène d'urgence", value: 'emergency-siren' },
  { label: 'Alarme critique', value: 'critical-alarm' },
  { label: "Klaxon d'urgence", value: 'emergency-horn' },
]

const alertSounds = [
  { label: 'Alarme urgente', value: 'urgent-alarm' },
  { label: "Bip d'alerte", value: 'alert-beep' },
  { label: "Sonnerie d'alerte", value: 'alert-ring' },
]

const notificationSounds = [
  { label: 'Carillon', value: 'notification-chime' },
  { label: 'Ding', value: 'notification-ding' },
  { label: 'Cloche', value: 'notification-bell' },
]

// Méthodes
const toggleDayOff = (day) => {
  const index = settings.value.schedule.daysOff.indexOf(day)
  if (index > -1) {
    settings.value.schedule.daysOff.splice(index, 1)
  } else {
    settings.value.schedule.daysOff.push(day)
  }
}

const playSound = (soundType) => {
  try {
    const audio = new Audio(`/sounds/${soundType}.mp3`)
    audio.volume = settings.value.sounds.volume / 100
    audio.play().catch((err) => {
      console.warn('Impossible de jouer le son:', err)
    })
  } catch (error) {
    console.warn('Erreur lecture son:', error)
  }
}

const testNotifications = async () => {
  try {
    const testEmergency = {
      urgencyLevel: 'URGENT',
      type: 'EMERGENCY_ALERT',
      title: 'Test de notification',
      message: "Ceci est un test de vos paramètres de notification d'urgence.",
      animalType: 'Chien',
      bloodType: 'DEA 1.1+',
      location: 'Test Location',
      estimatedTime: '15 minutes',
      targetUsers: ['current-user'],
    }

    await sendEmergencyNotification(testEmergency)
    console.log('🧪 Test de notification envoyé')
  } catch (error) {
    console.error('Erreur test notification:', error)
  }
}

const saveSettings = async () => {
  try {
    isSaving.value = true

    // Convertir les heures en format string
    if (quietHoursStart.value) {
      settings.value.schedule.quietHours.start = quietHoursStart.value.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    if (quietHoursEnd.value) {
      settings.value.schedule.quietHours.end = quietHoursEnd.value.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    // Sauvegarder dans le localStorage (à remplacer par une API)
    localStorage.setItem('emergency-settings', JSON.stringify(settings.value))

    console.log("✅ Paramètres d'urgence sauvegardés")

    // Fermer le dialog après un délai
    setTimeout(() => {
      emit('close')
    }, 1000)
  } catch (error) {
    console.error('Erreur sauvegarde paramètres:', error)
  } finally {
    isSaving.value = false
  }
}

const resetSettings = () => {
  settings.value = { ...defaultSettings }
  initializeTimeFields()
  console.log('🔄 Paramètres réinitialisés')
}

const loadSettings = () => {
  try {
    const saved = localStorage.getItem('emergency-settings')
    if (saved) {
      settings.value = { ...defaultSettings, ...JSON.parse(saved) }
    }
    initializeTimeFields()
  } catch (error) {
    console.error('Erreur chargement paramètres:', error)
    settings.value = { ...defaultSettings }
  }
}

const initializeTimeFields = () => {
  // Initialiser les champs de temps pour le composant Calendar
  const startTime = settings.value.schedule.quietHours.start.split(':')
  const endTime = settings.value.schedule.quietHours.end.split(':')

  quietHoursStart.value = new Date()
  quietHoursStart.value.setHours(parseInt(startTime[0]), parseInt(startTime[1]), 0, 0)

  quietHoursEnd.value = new Date()
  quietHoursEnd.value.setHours(parseInt(endTime[0]), parseInt(endTime[1]), 0, 0)
}

// Lifecycle
onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.emergency-settings {
  max-width: 800px;
  margin: 0 auto;
}

.settings-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.section-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--surface-border);
}

.section-header h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem 0;
  color: var(--primary-color);
  font-size: 1.125rem;
}

.section-header p {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

/* Grille des paramètres */
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}

.setting-group {
  margin-bottom: 1.5rem;
}

.setting-group h5 {
  margin: 0 0 1rem 0;
  color: var(--text-color);
  font-size: 1rem;
}

/* Options de canal */
.channel-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.channel-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.channel-icon {
  font-size: 1.25rem;
  color: var(--primary-color);
}

.channel-details {
  display: flex;
  flex-direction: column;
}

.channel-name {
  font-weight: 600;
  color: var(--text-color);
}

.channel-details small {
  color: var(--text-color-secondary);
}

/* Options d'urgence */
.urgency-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.urgency-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.urgency-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.urgency-info span {
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

/* Disponibilité */
.availability-settings {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.setting-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.setting-info h5 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.setting-info p {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.quiet-hours-config {
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
  margin-top: 1rem;
}

.time-range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  color: var(--text-color);
  font-size: 0.875rem;
}

.exception-setting {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.exception-setting label {
  color: var(--text-color);
  font-size: 0.875rem;
}

/* Jours d'indisponibilité */
.days-selection {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.day-option {
  padding: 0.5rem 1rem;
  background: var(--surface-100);
  border: 2px solid var(--surface-border);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
  font-weight: 600;
}

.day-option:hover {
  background: var(--surface-200);
}

.day-option.selected {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

/* Filtres */
.filter-settings {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.animal-filters,
.notification-types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.filter-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-option label {
  color: var(--text-color);
  font-size: 0.875rem;
}

/* Distance */
.distance-setting {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.distance-slider {
  flex: 1;
}

.distance-display {
  min-width: 60px;
  text-align: center;
  font-weight: 600;
  color: var(--primary-color);
}

/* Audio */
.audio-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.sound-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.sound-setting {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sound-setting label {
  font-weight: 600;
  color: var(--text-color);
  font-size: 0.875rem;
}

.sound-selector {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.sound-selector .p-select {
  flex: 1;
}

.volume-setting {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.volume-slider {
  flex: 1;
}

.volume-display {
  min-width: 50px;
  text-align: center;
  font-weight: 600;
  color: var(--primary-color);
}

/* Actions */
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--surface-border);
}

/* Responsive */
@media (max-width: 768px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .time-range {
    grid-template-columns: 1fr;
  }

  .animal-filters,
  .notification-types {
    grid-template-columns: 1fr;
  }

  .settings-actions {
    flex-direction: column-reverse;
  }

  .sound-selector {
    flex-direction: column;
    align-items: stretch;
  }

  .distance-setting,
  .volume-control {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
}
</style>
