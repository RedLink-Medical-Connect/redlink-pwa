<script setup>
import { ref, onMounted } from 'vue'
import { loadStripe } from '@stripe/stripe-js'
import { post } from 'aws-amplify/api' // Nouvelle méthode Amplify v6

// VOTRE CLÉ PUBLIQUE (pk_test_...) - Celle-ci peut être publique
const stripePromise = loadStripe('pk_test_51Sc1gTL3JgDp3G6ikoJ7E6OlL2ugf2lCaEWoJY1rNUiIJ1OkqilXLrryn8md5I9xfZgBvIfuYWuZraqu4UXzbQiB00ARTIBMOh')

const cardElement = ref(null)
const stripe = ref(null)
const elements = ref(null)
const message = ref('')
const loading = ref(false)

onMounted(async () => {
  stripe.value = await stripePromise
  elements.value = stripe.value.elements()

  // Création du champ CB sécurisé
  const card = elements.value.create('card')
  card.mount(cardElement.value)
})

const handlePayment = async () => {
  loading.value = true
  message.value = 'Initialisation...'

  try {
    // 1. Appeler notre API AWS pour avoir l'autorisation
    const restOperation = post({
      apiName: 'apiStripe', // Le nom donné à l'étape 2
      path: '/payment'
    })

    const { body } = await restOperation.response
    const data = await body.json()
    const clientSecret = data.clientSecret

    // 2. Confirmer le paiement avec Stripe (depuis le navigateur)
    const result = await stripe.value.confirmCardPayment(clientSecret, {
      payment_method: {
        card: elements.value.getElement('card'),
        billing_details: { name: 'Test User' } // Vous pourrez mettre le nom de la clinique ici
      }
    })

    if (result.error) {
      message.value = `Erreur : ${result.error.message}`
    } else {
      if (result.paymentIntent.status === 'requires_capture') {
        message.value = 'SUCCÈS ! 50€ sont bloqués (Pre-Auth) ! Vérifiez votre Dashboard Stripe.'
      } else {
        message.value = `Statut inattendu : ${result.paymentIntent.status}`
      }
    }
  } catch (err) {
    console.error(err)
    message.value = "Erreur technique : " + err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="p-10 max-w-md mx-auto">
    <h1 class="text-2xl font-bold mb-6">Test Empreinte Bancaire (50€)</h1>

    <div class="bg-white p-4 rounded border border-gray-300 mb-6">
      <div ref="cardElement"></div>
    </div>

    <button
      class="bg-blue-600 text-white px-6 py-3 rounded font-bold w-full hover:bg-blue-700 disabled:opacity-50"
      @click="handlePayment"
      :disabled="loading"
    >
      {{ loading ? 'Traitement...' : 'Bloquer 50€' }}
    </button>

    <div v-if="message" class="mt-6 p-4 rounded bg-gray-100 text-sm font-mono">
      {{ message }}
    </div>
  </div>
</template>
