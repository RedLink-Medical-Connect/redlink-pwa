const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // 1. Gérer les Headers pour CORS (Autoriser le Frontend à parler au Backend)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*"
  };

  // Gestion des requêtes OPTIONS (Pre-flight check du navigateur)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify('CORS success') };
  }

  try {
    // 2. Création de l'intention de paiement (Pre-Authorization)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 5000, // 50.00 EUR (Stripe compte en centimes)
      currency: 'eur',
      payment_method_types: ['card'],
      // C'EST LA LIGNE MAGIQUE POUR VOTRE SYSTÈME ANTI-ARNAQUE :
      capture_method: 'manual',
    });

    // 3. Succès : On renvoie le secret au Frontend
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret
      }),
    };

  } catch (error) {
    // 4. Erreur
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
