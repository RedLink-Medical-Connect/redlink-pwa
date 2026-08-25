<script setup>
import LegalDocumentPage from '@/components/legal/LegalDocumentPage.vue'
import { LEGAL_NOTICE_VERSION } from '@/constants/legal.js'

const { version, publishedAt } = LEGAL_NOTICE_VERSION
</script>

<template>
  <LegalDocumentPage
    title-key="legal.notice.title"
    slug="legal-notice"
    :version="version"
    :published-at="publishedAt"
  />
</template>
