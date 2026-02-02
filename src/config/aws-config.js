/**
 * Configuration AWS sécurisée utilisant les variables d'environnement
 * Remplace amplifyconfiguration.json pour éviter l'exposition des secrets
 */

const awsConfig = {
  aws_project_region: import.meta.env.VITE_AWS_REGION || 'eu-west-3',

  // API Gateway personnalisée (Stripe - sera désactivée en MVP)
  aws_cloud_logic_custom: [
    {
      name: 'apiStripe',
      endpoint: import.meta.env.VITE_API_STRIPE_ENDPOINT,
      region: import.meta.env.VITE_AWS_REGION || 'eu-west-3',
    },
  ],

  // AppSync GraphQL
  aws_appsync_graphqlEndpoint: import.meta.env.VITE_AWS_APPSYNC_GRAPHQL_ENDPOINT,
  aws_appsync_region: import.meta.env.VITE_AWS_APPSYNC_REGION || 'eu-west-3',
  aws_appsync_authenticationType:
    import.meta.env.VITE_AWS_APPSYNC_AUTH_TYPE || 'AMAZON_COGNITO_USER_POOLS',

  // Cognito
  aws_cognito_identity_pool_id: import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID,
  aws_cognito_region: import.meta.env.VITE_AWS_COGNITO_REGION || 'eu-west-3',
  aws_user_pools_id: import.meta.env.VITE_AWS_USER_POOLS_ID,
  aws_user_pools_web_client_id: import.meta.env.VITE_AWS_USER_POOLS_WEB_CLIENT_ID,

  // Configuration OAuth (vide pour l'instant)
  oauth: {},

  // Attributs Cognito
  aws_cognito_username_attributes: ['EMAIL'],
  aws_cognito_social_providers: [],
  aws_cognito_signup_attributes: ['EMAIL'],
  aws_cognito_mfa_configuration: 'OFF',
  aws_cognito_mfa_types: ['SMS'],
  aws_cognito_password_protection_settings: {
    passwordPolicyMinLength: 8,
    passwordPolicyCharacters: [],
  },
  aws_cognito_verification_mechanisms: ['EMAIL'],

  // Géolocalisation
  geo: {
    amazon_location_service: {
      region: import.meta.env.VITE_AWS_GEO_REGION || 'eu-west-1',
      search_indices: {
        items: [import.meta.env.VITE_AWS_GEO_SEARCH_INDEX || 'placeIndex-dev'],
        default: import.meta.env.VITE_AWS_GEO_SEARCH_INDEX || 'placeIndex-dev',
      },
    },
  },
}

// Validation des variables d'environnement critiques
const requiredEnvVars = [
  'VITE_AWS_APPSYNC_GRAPHQL_ENDPOINT',
  'VITE_AWS_COGNITO_IDENTITY_POOL_ID',
  'VITE_AWS_USER_POOLS_ID',
  'VITE_AWS_USER_POOLS_WEB_CLIENT_ID',
]

const missingVars = requiredEnvVars.filter((varName) => !import.meta.env[varName])

if (missingVars.length > 0) {
  console.error("❌ Variables d'environnement manquantes:", missingVars)
  console.error('📋 Copiez .env.example vers .env et configurez les valeurs')
  throw new Error(`Variables d'environnement manquantes: ${missingVars.join(', ')}`)
}

// Log de configuration en développement (sans les secrets)
if (import.meta.env.DEV) {
  console.log('🔧 Configuration AWS chargée:', {
    region: awsConfig.aws_project_region,
    appsync: awsConfig.aws_appsync_graphqlEndpoint ? '✅ Configuré' : '❌ Manquant',
    cognito: awsConfig.aws_user_pools_id ? '✅ Configuré' : '❌ Manquant',
    geo: awsConfig.geo.amazon_location_service.region,
  })
}

export default awsConfig
