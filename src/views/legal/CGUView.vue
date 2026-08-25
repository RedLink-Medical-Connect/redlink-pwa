<script setup>
import LegalDocumentPage from '@/components/legal/LegalDocumentPage.vue'
import { LEGAL_DOCUMENT_VERSIONS } from '@/constants/legal.js'
import { LegalDocumentType } from '@/constants/enums.js'

const { version, publishedAt } = LEGAL_DOCUMENT_VERSIONS[LegalDocumentType.CGU]
</script>

<template>
  <LegalDocumentPage
    title-key="legal.cgu.title"
    slug="cgu"
    :version="version"
    :published-at="publishedAt"
  />
</template>
