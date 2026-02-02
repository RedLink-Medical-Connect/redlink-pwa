<template>
  <div v-if="shouldShow" class="notification-badge">
    <div :class="badgeClasses" :style="badgeStyles">
      {{ displayText }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  count: {
    type: Number,
    default: 0,
  },
  maxCount: {
    type: Number,
    default: 99,
  },
  showZero: {
    type: Boolean,
    default: false,
  },
  severity: {
    type: String,
    default: 'danger',
    validator: (value) => ['success', 'info', 'warning', 'danger', 'secondary'].includes(value),
  },
  size: {
    type: String,
    default: 'normal',
    validator: (value) => ['small', 'normal', 'large'].includes(value),
  },
  dot: {
    type: Boolean,
    default: false,
  },
  pulse: {
    type: Boolean,
    default: false,
  },
  position: {
    type: String,
    default: 'top-right',
    validator: (value) =>
      ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'inline'].includes(value),
  },
})

// Propriétés calculées
const shouldShow = computed(() => {
  return props.count > 0 || props.showZero
})

const displayText = computed(() => {
  if (props.dot) return ''
  if (props.count > props.maxCount) return `${props.maxCount}+`
  return props.count.toString()
})

const badgeClasses = computed(() => {
  return [
    'badge',
    `badge-${props.severity}`,
    `badge-${props.size}`,
    `badge-${props.position}`,
    {
      'badge-dot': props.dot,
      'badge-pulse': props.pulse,
      'badge-zero': props.count === 0 && props.showZero,
    },
  ]
})

const badgeStyles = computed(() => {
  const styles = {}

  // Animation pulse pour les notifications critiques
  if (props.pulse && props.count > 0) {
    styles.animation = 'badgePulse 2s infinite'
  }

  return styles
})
</script>

<style scoped>
.notification-badge {
  position: relative;
  display: inline-block;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.75rem;
  line-height: 1;
  border-radius: 50%;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  white-space: nowrap;
  vertical-align: baseline;
  position: relative;
}

/* Tailles */
.badge-small {
  min-width: 1rem;
  height: 1rem;
  font-size: 0.625rem;
}

.badge-large {
  min-width: 1.5rem;
  height: 1.5rem;
  font-size: 0.875rem;
}

/* Couleurs */
.badge-success {
  background-color: var(--green-500);
  color: white;
}

.badge-info {
  background-color: var(--blue-500);
  color: white;
}

.badge-warning {
  background-color: var(--orange-500);
  color: white;
}

.badge-danger {
  background-color: var(--red-500);
  color: white;
}

.badge-secondary {
  background-color: var(--surface-500);
  color: white;
}

/* Positions */
.badge-top-right {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  z-index: 10;
}

.badge-top-left {
  position: absolute;
  top: -0.5rem;
  left: -0.5rem;
  z-index: 10;
}

.badge-bottom-right {
  position: absolute;
  bottom: -0.5rem;
  right: -0.5rem;
  z-index: 10;
}

.badge-bottom-left {
  position: absolute;
  bottom: -0.5rem;
  left: -0.5rem;
  z-index: 10;
}

.badge-inline {
  position: static;
  margin-left: 0.5rem;
}

/* Badge point */
.badge-dot {
  min-width: 0.5rem;
  height: 0.5rem;
  padding: 0;
  border-radius: 50%;
}

.badge-dot.badge-small {
  min-width: 0.375rem;
  height: 0.375rem;
}

.badge-dot.badge-large {
  min-width: 0.625rem;
  height: 0.625rem;
}

/* Badge zéro */
.badge-zero {
  background-color: var(--surface-300);
  color: var(--text-color-secondary);
}

/* Animation pulse */
.badge-pulse {
  animation: badgePulse 2s infinite;
}

@keyframes badgePulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 currentColor;
  }
  50% {
    transform: scale(1.1);
    box-shadow: 0 0 0 4px transparent;
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 transparent;
  }
}

/* Effet hover pour les badges interactifs */
.badge:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}

/* Accessibilité */
.badge:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

/* Responsive */
@media (max-width: 768px) {
  .badge {
    min-width: 1.125rem;
    height: 1.125rem;
    font-size: 0.6875rem;
  }

  .badge-small {
    min-width: 0.875rem;
    height: 0.875rem;
    font-size: 0.5625rem;
  }

  .badge-large {
    min-width: 1.375rem;
    height: 1.375rem;
    font-size: 0.8125rem;
  }
}

/* Thème sombre */
@media (prefers-color-scheme: dark) {
  .badge-zero {
    background-color: var(--surface-600);
    color: var(--text-color-secondary);
  }
}
</style>
