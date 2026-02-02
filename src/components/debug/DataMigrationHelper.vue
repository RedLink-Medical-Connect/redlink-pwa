<template>
  <div
    class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 mb-6"
  >
    <div class="flex items-start gap-3">
      <i class="pi pi-exclamation-triangle text-yellow-600 text-xl mt-1"></i>
      <div class="flex-1">
        <h3 class="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
          Profil vétérinaire non trouvé
        </h3>
        <p class="text-yellow-700 dark:text-yellow-300 mb-4">
          Votre profil vétérinaire n'a pas pu être récupéré. Cela peut arriver si les données ont
          été créées avant la mise à jour du système d'authentification.
        </p>

        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Button
              label="Analyser les données"
              size="small"
              severity="warning"
              outlined
              :loading="isAnalyzing"
              @click="analyzeData"
            />
            <span class="text-sm text-yellow-600 dark:text-yellow-400">
              Vérifier l'état actuel de vos données
            </span>
          </div>

          <div v-if="analysisResult" class="bg-white dark:bg-zinc-800 rounded p-4 border">
            <h4 class="font-semibold mb-2">Résultat de l'analyse :</h4>
            <div v-if="analysisResult.needsMigration" class="space-y-2">
              <p class="text-sm text-red-600 dark:text-red-400">
                ❌ Aucun profil avec votre ID utilisateur ({{ analysisResult.userId }})
              </p>
              <p class="text-sm text-blue-600 dark:text-blue-400">
                📋 {{ analysisResult.vets.length }} profil(s) vétérinaire(s) trouvé(s)
              </p>
              <div v-if="analysisResult.vets.length === 1" class="mt-3">
                <Button
                  label="Migrer automatiquement"
                  size="small"
                  severity="success"
                  :loading="isMigrating"
                  @click="migrateData"
                />
                <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Cela va associer le profil existant à votre compte utilisateur
                </p>
              </div>
              <div v-else-if="analysisResult.vets.length > 1" class="mt-3">
                <p class="text-sm text-orange-600 dark:text-orange-400">
                  ⚠️ Plusieurs profils trouvés. Migration manuelle requise.
                </p>
                <div class="mt-2 space-y-1">
                  <div v-for="(vet, index) in analysisResult.vets" :key="vet.id" class="text-xs">
                    {{ index + 1 }}. {{ vet.firstname }} {{ vet.lastname }} ({{ vet.email }})
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-green-600 dark:text-green-400">
              ✅ Profil correctement configuré
            </div>
          </div>

          <div
            class="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 p-3 rounded"
          >
            <strong>Console de débogage :</strong> Ouvrez la console du navigateur (F12) pour plus
            d'options avancées.
            <br />
            Fonctions disponibles : <code>debugData()</code>,
            <code>migrateVeterinarianData()</code>, <code>analyzeCurrentData()</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useDataMigration } from '@/composables/useDataMigration.js'
import { useToast } from 'primevue/usetoast'

const { migrateVeterinarianData } = useDataMigration()
const toast = useToast()

const isAnalyzing = ref(false)
const isMigrating = ref(false)
const analysisResult = ref(null)

const emit = defineEmits(['migrationSuccess'])

const analyzeData = async () => {
  isAnalyzing.value = true
  try {
    // Utiliser la fonction d'analyse depuis le script de migration
    if (window.analyzeCurrentData) {
      const result = await window.analyzeCurrentData()
      analysisResult.value = result
    } else {
      toast.add({
        severity: 'error',
        summary: 'Erreur',
        detail: "Fonction d'analyse non disponible",
        life: 3000,
      })
    }
  } catch (error) {
    console.error("Erreur lors de l'analyse:", error)
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: "Erreur lors de l'analyse des données",
      life: 3000,
    })
  } finally {
    isAnalyzing.value = false
  }
}

const migrateData = async () => {
  isMigrating.value = true
  try {
    const result = await migrateVeterinarianData()

    if (result.success) {
      toast.add({
        severity: 'success',
        summary: 'Migration réussie',
        detail: 'Votre profil a été migré avec succès',
        life: 3000,
      })
      emit('migrationSuccess')
    } else {
      toast.add({
        severity: 'error',
        summary: 'Migration échouée',
        detail: result.message || 'Erreur lors de la migration',
        life: 5000,
      })
    }
  } catch (error) {
    console.error('Erreur lors de la migration:', error)
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: 'Erreur lors de la migration des données',
      life: 3000,
    })
  } finally {
    isMigrating.value = false
  }
}
</script>
