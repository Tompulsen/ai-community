<script setup lang="ts">
import BrowserStoragePanel from '../components/BrowserStoragePanel.vue'
</script>

<template>
  <main class="storage-recovery-page">
    <header><p class="recovery-brand">章鱼社区 · 本地维护</p><h1>浏览器存储恢复</h1><p>正常页面无法打开时，可在这里检查本地存储。此页面无需登录，不恢复聊天记录或读取原图、视频内容。</p></header>
    <BrowserStoragePanel recovery />
  </main>
</template>
