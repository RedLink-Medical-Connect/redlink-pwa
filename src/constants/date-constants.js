export const DAYS_OF_WEEK = [
  { label: 'Lundi', value: 1 },
  { label: 'Mardi', value: 2 },
  { label: 'Mercredi', value: 3 },
  { label: 'Jeudi', value: 4 },
  { label: 'Vendredi', value: 5 },
  { label: 'Samedi', value: 6 },
  { label: 'Dimanche', value: 0 },
]

export const getDayLabel = (dayIndex) => {
  const day = DAYS_OF_WEEK.find((d) => d.value === dayIndex)
  return day ? day.label : 'Inconnu'
}
