<!--
@file src/features/settings/ui/CloudConfigBackup.vue
文件职责：提供 Google Drive 配置云备份的唯一入口。
主要内容：展示备份范围与隐私说明，承载 Google Drive 连接、上传和恢复界面。
模块边界：只拥有 UI 忙碌状态；供应商连接和云备份事务交给 Drive 客户端及共用预览界面。
-->
<template>
  <section class="cloud-backup" aria-labelledby="cloud-backup-title" data-testid="cloud-config-backup">
    <header class="settings-card-heading"><div class="settings-card-heading-copy"><h2 id="cloud-backup-title">{{ t('settings.cloud.title') }}</h2><p class="cloud-description">{{ t('settings.cloud.description') }}</p></div><el-tooltip effect="light" placement="bottom-end" :show-after="150" :trigger="['hover', 'focus']"><template #content><div class="cloud-privacy-help"><strong>{{ t('settings.drive.privacyTitle') }}</strong><ul><li>{{ t('settings.cloud.privacyEncryption') }}</li><li>{{ t('settings.drive.privacyStorage') }}</li><li>{{ t('settings.drive.privacyAuthorization') }}</li><li>{{ t('settings.drive.privacyExcluded') }}</li></ul></div></template><button type="button" class="cloud-privacy" :aria-label="t('settings.drive.privacyTitle')" data-testid="cloud-backup-privacy"><el-icon><Lock /></el-icon>{{ t('settings.drive.privacyBadge') }}</button></el-tooltip></header>
    <el-alert v-if="!hasExtensionBackground" :title="t('settings.cloud.unavailable')" type="info" :closable="false" show-icon />
    <GoogleDriveSync v-else @busy="busy = $event" />
  </section>
</template>
<script setup lang="ts">
import {ref} from 'vue';
import {ElAlert, ElTooltip} from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/tooltip/style/css';
import {Lock} from '@element-plus/icons-vue';
import {useUiI18n} from '@/src/ui/i18n';
import GoogleDriveSync from './GoogleDriveSync.vue';
const {t} = useUiI18n();
const hasExtensionBackground = import.meta.env.BROWSER !== 'userscript';
const busy = ref(false);
</script>
<style scoped>
.cloud-backup {padding:24px; margin-bottom:24px; border:1px solid var(--el-border-color); border-radius:16px; background:var(--el-bg-color); color:var(--el-text-color-primary);}
.cloud-backup>header {display:flex; align-items:center; justify-content:space-between; gap:12px; margin:-24px -24px 20px; padding:12px 24px; border-bottom:1px solid var(--line); border-radius:15px 15px 0 0;}
.cloud-backup h2 {font-size:16px; margin:0;}
.cloud-description {font-size:12px; line-height:1.55; color:var(--muted); margin:0;}
.cloud-privacy {display:inline-flex; align-items:center; gap:5px; font:inherit; font-size:12px; color:var(--el-text-color-secondary); white-space:nowrap; border:0; border-radius:20px; padding:4px 10px; background:var(--el-fill-color-light); cursor:help;}
.cloud-privacy:hover,.cloud-privacy:focus {color:var(--el-color-success); background:var(--el-color-success-light-9);}
.cloud-privacy:focus-visible {outline:2px solid var(--el-color-success); outline-offset:3px;}
.cloud-privacy-help {width:min(300px, calc(100vw - 64px)); font-size:13px; line-height:1.7; color:var(--el-text-color-regular);}
.cloud-privacy-help strong {color:var(--el-text-color-primary);}
.cloud-privacy-help ul {margin:8px 0 0; padding-left:18px;}
.cloud-privacy-help li+li {margin-top:6px;}
@media(max-width:600px) {.cloud-backup {padding:16px;} .cloud-backup>header {margin:-16px -16px 16px; padding:12px 20px;}}
</style>
