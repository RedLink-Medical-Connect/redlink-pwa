<template>
  <div class="advanced-notification-settings">
    <!-- Header -->
    <div class="settings-header">
      <h2>
        <i class="pi pi-cog"></i>
        Paramètres avancés de notifications
      </h2>
      <p>Configuration détaillée pour optimiser votre expérience de notifications d'urgence</p>
    </div>

    <!-- Onglets de configuration -->
    <TabView>
      <!-- Horaires de disponibilité -->
      <TabPanel header="Horaires" left-icon="pi pi-clock">
        <div class="availability-config">
          <div class="section-title">
            <h3>Horaires de disponibilité</h3>
            <p>Définissez vos créneaux de disponibilité pour recevoir des notifications</p>
          </div>

          <!-- Planning hebdomadaire -->
          <div class="weekly-schedule">
            <div v-for="day in daysOfWeek" :key="day.value" class="day-schedule">
              <div class="day-header">
                <div class="day-info">
                  <h4>{{ day.label }}</h4>
                  <ToggleSwitch
                    v-model="settings.availability[day.value].enabled"
                    @change="updateDayAvailability(day.value)"
                  />
                </div>
              </div>

              <div v-if="settings.availability[day.value].enabled" class="time-slots">
                <div
                  v-for="(slot, index) in settings.availability[day.value].slots"
                  :key="index"
                  class="time-slot"
                >
                  <Calendar
                    v-model="slot.start"
                    time-only
                    hour-format="24"
                    placeholder="Début"
                    class="time-input"
                  />
                  <span class="time-separator">à</span>
                  <Calendar
                    v-model="slot.end"
                    time-only
                    hour-format="24"
                    placeholder="Fin"
                    class="time-input"
                  />
                  <Button
                    icon="pi pi-trash"
                    size="small"
                    severity="danger"
                    text
                    @click="removeTimeSlot(day.value, index)"
                  />
                </div>

                <Button
                  label="Ajouter un créneau"
                  icon="pi pi-plus"
                  size="small"
                  outlined
                  @click="addTimeSlot(day.value)"
                />
              </div>
            </div>
          </div>

          <!-- Exceptions -->
          <div class="exceptions-config">
            <h4>Exceptions et congés</h4>
            <div class="exception-list">
              <div
                v-for="(exception, index) in settings.exceptions"
                :key="index"
                class="exception-item"
              >
                <Calendar
                  v-model="exception.date"
                  placeholder="Date d'exception"
                  date-format="dd/mm/yy"
                />
                <InputText v-model="exception.reason" placeholder="Raison (optionnel)" />
                <ToggleSwitch
                  v-model="exception.allowCritical"
                  v-tooltip="'Autoriser les urgences critiques'"
                />
                <Button
                  icon="pi pi-trash"
                  size="small"
                  severity="danger"
                  text
                  @click="removeException(index)"
                />
              </div>
            </div>
            <Button
              label="Ajouter une exception"
              icon="pi pi-plus"
              outlined
              @click="addException"
            />
          </div>
        </div>
      </TabPanel>

      <!-- Filtres géographiques -->
      <TabPanel header="Géographie" left-icon="pi pi-map">
        <div class="geographic-config">
          <div class="section-title">
            <h3>Filtres géographiques</h3>
            <p>Configurez les zones géographiques pour lesquelles vous souhaitez être notifié</p>
          </div>

          <!-- Zone principale -->
          <div class="primary-zone">
            <h4>Zone principale</h4>
            <div class="zone-config">
              <div class="field-group">
                <div class="field">
                  <label>Adresse de référence</label>
                  <InputText
                    v-model="settings.geography.primaryAddress"
                    placeholder="Votre adresse principale"
                  />
                </div>
                <div class="field">
                  <label>Rayon maximum (km)</label>
                  <div class="radius-control">
                    <Slider
                      v-model="settings.geography.primaryRadius"
                      :min="1"
                      :max="100"
                      :step="1"
                    />
                    <span class="radius-value">{{ settings.geography.primaryRadius }} km</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Zones secondaires -->
          <div class="secondary-zones">
            <h4>Zones secondaires</h4>
            <div class="zones-list">
              <div
                v-for="(zone, index) in settings.geography.secondaryZones"
                :key="index"
                class="zone-item"
              >
                <InputText v-model="zone.address" placeholder="Adresse de la zone" />
                <div class="radius-control">
                  <Slider v-model="zone.radius" :min="1" :max="50" :step="1" />
                  <span class="radius-value">{{ zone.radius }} km</span>
                </div>
                <Button
                  icon="pi pi-trash"
                  size="small"
                  severity="danger"
                  text
                  @click="removeSecondaryZone(index)"
                />
              </div>
            </div>
            <Button label="Ajouter une zone" icon="pi pi-plus" outlined @click="addSecondaryZone" />
          </div>

          <!-- Exclusions géographiques -->
          <div class="exclusion-zones">
            <h4>Zones d'exclusion</h4>
            <p>Zones où vous ne souhaitez pas recevoir de notifications</p>
            <div class="exclusions-list">
              <div
                v-for="(exclusion, index) in settings.geography.exclusions"
                :key="index"
                class="exclusion-item"
              >
                <InputText v-model="exclusion.address" placeholder="Adresse à exclure" />
                <InputText v-model="exclusion.reason" placeholder="Raison (optionnel)" />
                <Button
                  icon="pi pi-trash"
                  size="small"
                  severity="danger"
                  text
                  @click="removeExclusion(index)"
                />
              </div>
            </div>
            <Button
              label="Ajouter une exclusion"
              icon="pi pi-plus"
              outlined
              @click="addExclusion"
            />
          </div>
        </div>
      </TabPanel>

      <!-- Filtres par type d'urgence -->
      <TabPanel header="Types d'urgence" left-icon="pi pi-filter">
        <div class="urgency-filters">
          <div class="section-title">
            <h3>Filtres par type d'urgence</h3>
            <p>Personnalisez les types d'urgences pour lesquelles vous souhaitez être notifié</p>
          </div>

          <!-- Filtres par animal -->
          <div class="animal-filters">
            <h4>Types d'animaux</h4>
            <div class="filter-grid">
              <div
                v-for="animal in animalTypes"
                :key="animal.value"
                class="filter-card"
                :class="{ active: settings.filters.animals.includes(animal.value) }"
                @click="toggleAnimalFilter(animal.value)"
              >
                <i :class="animal.icon"></i>
                <span>{{ animal.label }}</span>
                <div class="filter-toggle">
                  <i
                    :class="
                      settings.filters.animals.includes(animal.value)
                        ? 'pi pi-check'
                        : 'pi pi-times'
                    "
                  ></i>
                </div>
              </div>
            </div>
          </div>

          <!-- Filtres par groupe sanguin -->
          <div class="blood-type-filters">
            <h4>Groupes sanguins</h4>
            <div class="blood-type-config">
              <div class="animal-blood-types">
                <h5>Chiens (DEA)</h5>
                <div class="blood-options">
                  <div v-for="type in dogBloodTypes" :key="type.value" class="blood-option">
                    <Checkbox
                      :id="`dog-${type.value}`"
                      v-model="settings.filters.bloodTypes.dog"
                      :value="type.value"
                    />
                    <label :for="`dog-${type.value}`">{{ type.label }}</label>
                  </div>
                </div>
              </div>

              <div class="animal-blood-types">
                <h5>Chats</h5>
                <div class="blood-options">
                  <div v-for="type in catBloodTypes" :key="type.value" class="blood-option">
                    <Checkbox
                      :id="`cat-${type.value}`"
                      v-model="settings.filters.bloodTypes.cat"
                      :value="type.value"
                    />
                    <label :for="`cat-${type.value}`">{{ type.label }}</label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Filtres par urgence -->
          <div class="urgency-level-filters">
            <h4>Niveaux d'urgence</h4>
            <div class="urgency-options">
              <div v-for="level in urgencyLevels" :key="level.value" class="urgency-option">
                <div class="urgency-header">
                  <ToggleSwitch v-model="settings.filters.urgencyLevels[level.value]" />
                  <div class="urgency-info">
                    <Tag :value="level.label" :severity="level.severity" />
                    <span class="urgency-description">{{ level.description }}</span>
                  </div>
                </div>

                <div v-if="settings.filters.urgencyLevels[level.value]" class="urgency-config">
                  <div class="field">
                    <label>Délai de réponse souhaité</label>
                    <Select
                      v-model="settings.filters.responseTime[level.value]"
                      :options="responseTimeOptions"
                      option-label="label"
                      option-value="value"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </TabPanel>

      <!-- Optimisation automatique -->
      <TabPanel header="Optimisation" left-icon="pi pi-chart-line">
        <div class="optimization-config">
          <div class="section-title">
            <h3>Optimisation automatique</h3>
            <p>Laissez le système optimiser automatiquement vos paramètres selon vos habitudes</p>
          </div>

          <!-- Apprentissage automatique -->
          <div class="ml-optimization">
            <div class="optimization-option">
              <div class="option-header">
                <ToggleSwitch v-model="settings.optimization.enabled" />
                <div class="option-info">
                  <h4>Optimisation intelligente</h4>
                  <p>
                    Le système apprend de vos réponses pour améliorer la pertinence des
                    notifications
                  </p>
                </div>
              </div>

              <div v-if="settings.optimization.enabled" class="optimization-details">
                <div class="learning-stats">
                  <div class="stat-item">
                    <span class="stat-label">Notifications analysées</span>
                    <span class="stat-value">{{ optimizationStats.totalNotifications }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Taux de réponse</span>
                    <span class="stat-value">{{ optimizationStats.responseRate }}%</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Temps de réponse moyen</span>
                    <span class="stat-value">{{ optimizationStats.avgResponseTime }}</span>
                  </div>
                </div>

                <div class="optimization-controls">
                  <div class="field">
                    <label>Agressivité de l'optimisation</label>
                    <div class="aggressiveness-control">
                      <Slider
                        v-model="settings.optimization.aggressiveness"
                        :min="1"
                        :max="5"
                        :step="1"
                      />
                      <div class="aggressiveness-labels">
                        <span>Conservateur</span>
                        <span>Agressif</span>
                      </div>
                    </div>
                  </div>

                  <div class="field">
                    <Checkbox
                      id="autoAdjustRadius"
                      v-model="settings.optimization.autoAdjustRadius"
                      binary
                    />
                    <label for="autoAdjustRadius"
                      >Ajuster automatiquement le rayon géographique</label
                    >
                  </div>

                  <div class="field">
                    <Checkbox
                      id="autoAdjustTiming"
                      v-model="settings.optimization.autoAdjustTiming"
                      binary
                    />
                    <label for="autoAdjustTiming">Optimiser les horaires selon mes habitudes</label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Suggestions d'amélioration -->
          <div class="improvement-suggestions">
            <h4>Suggestions d'amélioration</h4>
            <div class="suggestions-list">
              <div
                v-for="suggestion in suggestions"
                :key="suggestion.id"
                class="suggestion-item"
                :class="suggestion.type"
              >
                <div class="suggestion-icon">
                  <i :class="suggestion.icon"></i>
                </div>
                <div class="suggestion-content">
                  <h5>{{ suggestion.title }}</h5>
                  <p>{{ suggestion.description }}</p>
                  <div class="suggestion-impact">
                    <Tag
                      :value="`Impact: ${suggestion.impact}`"
                      :severity="suggestion.impactSeverity"
                    />
                  </div>
                </div>
                <div class="suggestion-actions">
                  <Button label="Appliquer" size="small" @click="applySuggestion(suggestion)" />
                  <Button
                    label="Ignorer"
                    size="small"
                    outlined
                    @click="ignoreSuggestion(suggestion)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </TabPanel>
    </TabView>

    <!-- Actions -->
    <div class="settings-actions">
      <Button
        label="Réinitialiser tout"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        @click="resetAllSettings"
      />
      <Button
        label="Exporter la configuration"
        icon="pi pi-download"
        outlined
        @click="exportSettings"
      />
      <Button
        label="Importer la configuration"
        icon="pi pi-upload"
        outlined
        @click="importSettings"
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
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import ToggleSwitch from 'primevue/toggleswitch'
import Calendar from 'primevue/calendar'
import InputText from 'primevue/inputtext'
import Slider from 'primevue/slider'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

// États
const isSaving = ref(false)

// Configuration par défaut
const defaultSettings = {
  availability: {
    monday: { enabled: true, slots: [{ start: new Date(), end: new Date() }] },
    tuesday: { enabled: true, slots: [{ start: new Date(), end: new Date() }] },
    wednesday: { enabled: true, slots: [{ start: new Date(), end: new Date() }] },
    thursday: { enabled: true, slots: [{ start: new Date(), end: new Date() }] },
    friday: { enabled: true, slots: [{ start: new Date(), end: new Date() }] },
    saturday: { enabled: false, slots: [] },
    sunday: { enabled: false, slots: [] },
  },
  exceptions: [],
  geography: {
    primaryAddress: '',
    primaryRadius: 25,
    secondaryZones: [],
    exclusions: [],
  },
  filters: {
    animals: ['dog', 'cat'],
    bloodTypes: {
      dog: ['DEA_1_1_POS', 'DEA_1_1_NEG'],
      cat: ['TYPE_A', 'TYPE_B'],
    },
    urgencyLevels: {
      CRITICAL: true,
      URGENT: true,
      HIGH: true,
    },
    responseTime: {
      CRITICAL: '5min',
      URGENT: '15min',
      HIGH: '30min',
    },
  },
  optimization: {
    enabled: true,
    aggressiveness: 3,
    autoAdjustRadius: true,
    autoAdjustTiming: true,
  },
}

// Paramètres actuels
const settings = ref({ ...defaultSettings })

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

const animalTypes = [
  { label: 'Chiens', value: 'dog', icon: 'pi pi-heart' },
  { label: 'Chats', value: 'cat', icon: 'pi pi-heart' },
  { label: 'Lapins', value: 'rabbit', icon: 'pi pi-heart' },
  { label: 'Furets', value: 'ferret', icon: 'pi pi-heart' },
  { label: 'Autres', value: 'other', icon: 'pi pi-heart' },
]

const dogBloodTypes = [
  { label: 'DEA 1.1+', value: 'DEA_1_1_POS' },
  { label: 'DEA 1.1-', value: 'DEA_1_1_NEG' },
  { label: 'DEA 3+', value: 'DEA_3_POS' },
  { label: 'DEA 3-', value: 'DEA_3_NEG' },
  { label: 'DEA 5+', value: 'DEA_5_POS' },
  { label: 'DEA 5-', value: 'DEA_5_NEG' },
]

const catBloodTypes = [
  { label: 'Type A', value: 'TYPE_A' },
  { label: 'Type B', value: 'TYPE_B' },
  { label: 'Type AB', value: 'TYPE_AB' },
]

const urgencyLevels = [
  {
    label: 'Critique',
    value: 'CRITICAL',
    severity: 'danger',
    description: 'Urgences vitales nécessitant une intervention immédiate',
  },
  {
    label: 'Urgent',
    value: 'URGENT',
    severity: 'warning',
    description: 'Situations urgentes mais non critiques',
  },
  {
    label: 'Élevé',
    value: 'HIGH',
    severity: 'info',
    description: 'Situations importantes nécessitant attention',
  },
]

const responseTimeOptions = [
  { label: '2 minutes', value: '2min' },
  { label: '5 minutes', value: '5min' },
  { label: '10 minutes', value: '10min' },
  { label: '15 minutes', value: '15min' },
  { label: '30 minutes', value: '30min' },
  { label: '1 heure', value: '1h' },
]

// Statistiques d'optimisation (simulées)
const optimizationStats = ref({
  totalNotifications: 247,
  responseRate: 87,
  avgResponseTime: '3min 24s',
})

// Suggestions d'amélioration (simulées)
const suggestions = ref([
  {
    id: 1,
    type: 'performance',
    icon: 'pi pi-chart-line',
    title: 'Optimiser le rayon géographique',
    description: 'Réduire votre rayon à 20km pourrait améliorer la pertinence de 15%',
    impact: 'Moyen',
    impactSeverity: 'warning',
  },
  {
    id: 2,
    type: 'timing',
    icon: 'pi pi-clock',
    title: 'Ajuster les horaires du weekend',
    description: 'Vous répondez souvent le samedi matin, voulez-vous activer ces créneaux ?',
    impact: 'Faible',
    impactSeverity: 'info',
  },
])

// Méthodes
const updateDayAvailability = (day) => {
  if (
    settings.value.availability[day].enabled &&
    settings.value.availability[day].slots.length === 0
  ) {
    addTimeSlot(day)
  }
}

const addTimeSlot = (day) => {
  const start = new Date()
  start.setHours(9, 0, 0, 0)
  const end = new Date()
  end.setHours(18, 0, 0, 0)

  settings.value.availability[day].slots.push({ start, end })
}

const removeTimeSlot = (day, index) => {
  settings.value.availability[day].slots.splice(index, 1)
}

const addException = () => {
  settings.value.exceptions.push({
    date: new Date(),
    reason: '',
    allowCritical: false,
  })
}

const removeException = (index) => {
  settings.value.exceptions.splice(index, 1)
}

const addSecondaryZone = () => {
  settings.value.geography.secondaryZones.push({
    address: '',
    radius: 15,
  })
}

const removeSecondaryZone = (index) => {
  settings.value.geography.secondaryZones.splice(index, 1)
}

const addExclusion = () => {
  settings.value.geography.exclusions.push({
    address: '',
    reason: '',
  })
}

const removeExclusion = (index) => {
  settings.value.geography.exclusions.splice(index, 1)
}

const toggleAnimalFilter = (animalType) => {
  const index = settings.value.filters.animals.indexOf(animalType)
  if (index > -1) {
    settings.value.filters.animals.splice(index, 1)
  } else {
    settings.value.filters.animals.push(animalType)
  }
}

const applySuggestion = (suggestion) => {
  console.log('Applying suggestion:', suggestion)
  // Implémenter l'application de la suggestion
}

const ignoreSuggestion = (suggestion) => {
  const index = suggestions.value.findIndex((s) => s.id === suggestion.id)
  if (index > -1) {
    suggestions.value.splice(index, 1)
  }
}

const resetAllSettings = () => {
  settings.value = { ...defaultSettings }
  console.log('🔄 Paramètres réinitialisés')
}

const exportSettings = () => {
  const dataStr = JSON.stringify(settings.value, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'notification-settings.json'
  link.click()
  URL.revokeObjectURL(url)
  console.log('📥 Configuration exportée')
}

const importSettings = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (event) => {
    const file = event.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const importedSettings = JSON.parse(e.target.result)
          settings.value = { ...defaultSettings, ...importedSettings }
          console.log('📤 Configuration importée')
        } catch (error) {
          console.error('Erreur import configuration:', error)
        }
      }
      reader.readAsText(file)
    }
  }
  input.click()
}

const saveSettings = async () => {
  try {
    isSaving.value = true

    // Sauvegarder dans le localStorage (à remplacer par une API)
    localStorage.setItem('advanced-notification-settings', JSON.stringify(settings.value))

    console.log('✅ Paramètres avancés sauvegardés')

    setTimeout(() => {
      isSaving.value = false
    }, 1000)
  } catch (error) {
    console.error('Erreur sauvegarde paramètres:', error)
    isSaving.value = false
  }
}

const loadSettings = () => {
  try {
    const saved = localStorage.getItem('advanced-notification-settings')
    if (saved) {
      settings.value = { ...defaultSettings, ...JSON.parse(saved) }
    }
  } catch (error) {
    console.error('Erreur chargement paramètres:', error)
    settings.value = { ...defaultSettings }
  }
}

// Lifecycle
onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.advanced-notification-settings {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}

.settings-header {
  margin-bottom: 2rem;
  text-align: center;
}

.settings-header h2 {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem 0;
  color: var(--primary-color);
}

.settings-header p {
  margin: 0;
  color: var(--text-color-secondary);
}

/* Sections communes */
.section-title {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--surface-border);
}

.section-title h3 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.section-title p {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

/* Planning hebdomadaire */
.weekly-schedule {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.day-schedule {
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.day-header {
  margin-bottom: 1rem;
}

.day-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.day-info h4 {
  margin: 0;
  color: var(--text-color);
}

.time-slots {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.time-slot {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.time-input {
  width: 120px;
}

.time-separator {
  color: var(--text-color-secondary);
  font-weight: 600;
}

/* Exceptions */
.exceptions-config {
  margin-top: 2rem;
  padding: 1.5rem;
  background: var(--surface-50);
  border-radius: 8px;
}

.exception-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}

.exception-item {
  display: flex;
  align-items: center;
  gap: 1rem;
}

/* Configuration géographique */
.geographic-config {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.zone-config,
.zones-list,
.exclusions-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.zone-item,
.exclusion-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--surface-card);
  border-radius: 6px;
}

.radius-control {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 200px;
}

.radius-value {
  min-width: 60px;
  text-align: center;
  font-weight: 600;
  color: var(--primary-color);
}

/* Filtres d'animaux */
.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.filter-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border: 2px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.filter-card:hover {
  border-color: var(--primary-color);
  transform: translateY(-2px);
}

.filter-card.active {
  border-color: var(--primary-color);
  background: var(--primary-50);
}

.filter-toggle {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.filter-card.active .filter-toggle {
  background: var(--primary-color);
  color: white;
}

.filter-card:not(.active) .filter-toggle {
  background: var(--surface-300);
  color: var(--text-color-secondary);
}

/* Groupes sanguins */
.blood-type-config {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}

.animal-blood-types h5 {
  margin: 0 0 1rem 0;
  color: var(--text-color);
}

.blood-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.blood-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Options d'urgence */
.urgency-options {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.urgency-option {
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.urgency-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.urgency-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.urgency-description {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.urgency-config {
  padding-left: 3rem;
}

/* Optimisation */
.optimization-config {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.optimization-option {
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.option-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.option-info h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.option-info p {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.learning-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--primary-color);
}

.aggressiveness-control {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.aggressiveness-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
  color: var(--text-color-secondary);
}

/* Suggestions */
.suggestions-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.suggestion-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
}

.suggestion-icon {
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-100);
  border-radius: 50%;
  color: var(--primary-600);
  font-size: 1.25rem;
}

.suggestion-content {
  flex: 1;
}

.suggestion-content h5 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.suggestion-content p {
  margin: 0 0 1rem 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.suggestion-actions {
  display: flex;
  gap: 0.5rem;
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
  .advanced-notification-settings {
    padding: 1rem;
  }

  .day-info {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .time-slot {
    flex-direction: column;
    align-items: stretch;
  }

  .exception-item,
  .zone-item,
  .exclusion-item {
    flex-direction: column;
    align-items: stretch;
  }

  .blood-type-config {
    grid-template-columns: 1fr;
  }

  .learning-stats {
    grid-template-columns: 1fr;
  }

  .suggestion-item {
    flex-direction: column;
    text-align: center;
  }

  .settings-actions {
    flex-direction: column-reverse;
  }
}
</style>
