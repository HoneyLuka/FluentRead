<!--
@file src/features/settings/ui/GoogleDriveSync.vue
文件职责：把 Google Drive 作为配置云备份的一种存储方式接入共用界面，并在 Web OAuth 构建（Safari 等无系统授权宿主）中执行 uBlacklist 式网页授权连接。
主要内容：Chrome 原生路径保持共用同步按钮；Web OAuth 路径按登录状态显示“连接 Google 账号并同步”或“立即同步”及退出连接入口；
授权流程为本页生成 PKCE 校验值与 state、新标签页打开 Google 同意页、监听页签导航截获重定向授权码并校验 state、交给后台 connect 换取保存刷新令牌并返回最新状态，然后继续共用预览；同步、删除与更换账号共用 interactiveAuth 钩子，连接结果由共用面板立即并入。
模块边界：不读取配置、口令、client secret 或访问令牌；预览和确认交互由 RemoteConfigSync 统一实现。
-->
<template>
  <RemoteConfigSync ref="panel" :client="googleDriveSyncClient" provider="Google Drive" kind="google-drive" :interactive-auth="runInteractiveAuth" @busy="$emit('busy', $event)">
    <template #actions="{available, busy, sync, status}">
      <el-button v-if="available && !status?.webOauth" type="primary" :loading="busy" :disabled="busy" data-testid="google-drive-sync-now" @click="sync">{{ t('settings.cloud.syncNow', {provider: 'Google Drive'}) }}</el-button>
      <template v-else-if="available && status?.webOauth">
        <el-button v-if="!status.webOauth.signedIn" type="primary" :loading="busy" :disabled="busy" data-testid="google-drive-web-connect" @click="sync">{{ t('settings.cloud.webConnectSync') }}</el-button>
        <el-button v-else type="primary" :loading="busy" :disabled="busy" data-testid="google-drive-sync-now" @click="sync">{{ t('settings.cloud.syncNow', {provider: 'Google Drive'}) }}</el-button>
        <el-button v-if="status.webOauth.signedIn" link :disabled="busy" data-testid="google-drive-web-sign-out" @click="signOut">{{ t('settings.cloud.webSignOut') }}</el-button>
      </template>
    </template>
  </RemoteConfigSync>
</template>
<script setup lang="ts">
import {onUnmounted, ref} from 'vue';
import {ElButton, ElMessage} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import browser from 'webextension-polyfill';
import RemoteConfigSync from './RemoteConfigSync.vue';
import {googleDriveSyncClient} from '@/src/services/config/googleDriveSyncClient';
import type {DriveSyncStatus} from '@/src/services/config/googleDriveSync';
import {CloudBackupRequestError} from '@/src/services/config/cloudBackupClient';
import {buildWebOauthAuthorizationUrl, deriveWebOauthChallenge, generateWebOauthState, generateWebOauthVerifier, readWebOauthAuthorizationResponse} from '@/src/platform/google-drive/webOauth';
import {useUiI18n} from '@/src/ui/i18n';

defineEmits<{busy: [value: boolean]}>();
const {t, translateLegacy} = useUiI18n();
const panel = ref<{refreshStatus: () => Promise<void>} | null>(null);
let alive = true;
let connecting = false;

/**
 * 在打开授权页前查询最新登录状态，避免本地缓存把已失效的连接误当作已登录。
 * 连接成功时返回后台的最新状态，由共用面板立即并入，入口随之切换为“立即同步”。
 */
async function runInteractiveAuth(context: {reason: 'sync' | 'delete' | 'switchAccount'}): Promise<DriveSyncStatus | void> {
  const status = await googleDriveSyncClient.status();
  const webOauth = status.webOauth;
  // Chrome 原生路径与未注入 Web OAuth 凭据的构建不执行网页授权。
  if (!webOauth) return;
  // 只有更换账号强制重新走同意页；日常同步与删除在已连接时直接复用刷新令牌。
  if (context.reason !== 'switchAccount' && webOauth.signedIn) return;
  if (connecting) throw new CloudBackupRequestError('Google 授权正在进行中，请稍候。');
  connecting = true;
  try {return await connectGoogleAccount(webOauth.clientId, webOauth.redirectUri);}
  finally {connecting = false;}
}

async function connectGoogleAccount(clientId: string, redirectUri: string): Promise<DriveSyncStatus> {
  const codeVerifier = generateWebOauthVerifier();
  const state = generateWebOauthState();
  const codeChallenge = await deriveWebOauthChallenge(codeVerifier);
  const authorizationUrl = buildWebOauthAuthorizationUrl({clientId, redirectUri, codeChallenge, state});
  const code = await captureAuthorizationCode(authorizationUrl, redirectUri, state);
  return googleDriveSyncClient.connect(code, codeVerifier);
}

/**
 * 打开 Google 同意页并截获重定向回回调页的授权码。
 * 只读取与回调页同源的导航地址；授权码截获后关闭授权页签，用户手动关闭页签视为取消。
 */
function captureAuthorizationCode(authorizationUrl: string, redirectUri: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let tabId: number | undefined;
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      settle();
    };
    const onUpdated = (updatedTabId: number, change: {url?: string}) => {
      if (updatedTabId !== tabId || typeof change.url !== 'string') return;
      const result = readWebOauthAuthorizationResponse(change.url, redirectUri);
      if (!result) return;
      if (result.state !== state) {finish(() => reject(new CloudBackupRequestError('Google 授权返回结果校验失败', 'settings.cloud.webAuthStateInvalid'))); return;}
      if ('error' in result) {finish(() => reject(new CloudBackupRequestError('Google 授权被拒绝', 'settings.cloud.webAuthDenied'))); return;}
      // 先结算再关闭页签：关闭事件可能在本页签被移除时先于异步回调到达，不能让已取得的授权码被误判为取消。
      finish(() => resolve(result.code));
      // 授权码已取得，回调页无需继续停留；关闭失败不影响本次连接。
      void browser.tabs.remove(updatedTabId).catch(() => undefined);
    };
    const onRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      finish(() => reject(new CloudBackupRequestError('Google 授权页已关闭', 'settings.cloud.webAuthTabClosed')));
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    void browser.tabs.create({url: authorizationUrl}).then(tab => {tabId = tab.id;}).catch(() => {
      finish(() => reject(new CloudBackupRequestError('无法打开 Google 授权页', 'settings.cloud.webAuthOpenFailed')));
    });
  });
}

async function signOut() {
  try {
    await googleDriveSyncClient.signOut();
    if (alive) {
      ElMessage.success(t('settings.cloud.webSignedOut'));
      await panel.value?.refreshStatus();
    }
  } catch (failure) {
    if (!alive) return;
    ElMessage.error(failure instanceof CloudBackupRequestError && failure.errorKey ? t(failure.errorKey, failure.params) : failure instanceof Error ? translateLegacy(failure.message) : translateLegacy('退出 Google 连接未完成，请重试'));
  }
}

onUnmounted(() => {alive = false;});
// 供父级（如备份入口卡片）在连接状态变化后同步刷新共用面板。
defineExpose({refreshStatus: async () => {await panel.value?.refreshStatus();}});
</script>
