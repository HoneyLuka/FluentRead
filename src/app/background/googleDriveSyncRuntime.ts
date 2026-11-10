/**
 * @file src/app/background/googleDriveSyncRuntime.ts
 * 文件职责：为后台加密同步服务连接现有完整配置与原生 Chrome 身份端口，并在无原生身份的宿主注入 Google Web OAuth 路径。
 * 主要内容：完整凭据读写、密文基线、设置页校验、由后台处理所属页签关闭或重新加载；Web OAuth 装配 PKCE 授权码交换、刷新令牌仓库与连接/退出动作。
 * 模块边界：仅装配依赖；配置写入复用现有持久化与修改队列，不向内容脚本公开密文基线；client secret 只在本后台使用。
 */
import {config, configReady, prepareHydratedConfigForExport, saveConfig} from '@/src/services/config/store';
import {prepareConfigForImport} from '@/src/core/config/transfer';
import {createDriveAuth, DriveError, type DriveIdentity} from '@/src/platform/google-drive/auth';
import {createDriveApi} from '@/src/platform/google-drive/api';
import {GOOGLE_DRIVE_SYNC_STATE_KEY, GOOGLE_DRIVE_WEB_CLIENT_ID, GOOGLE_DRIVE_WEB_CLIENT_SECRET, GOOGLE_DRIVE_WEB_REDIRECT_URI} from '@/src/platform/google-drive/constants';
import {exchangeWebOauthCode, isWebOauthConfigured, WebOauthError} from '@/src/platform/google-drive/webOauth';
import {createWebOauthCredentialsStore} from '@/src/platform/google-drive/webOauthCredentials';
import {configStorage} from '@/src/platform/storage/configStorageRuntime';
import {createGoogleDriveSync} from '@/src/services/config/googleDriveSync';
import {createGoogleDriveSyncHandler, type DriveWebOauthActions} from './handlers/googleDriveSync';
import {isTrustedSettingsSender} from './handlers/trustedSettingsSender';
import type {ConfigMutationCoordinator} from './handlers/configPersistence';

export function createGoogleDriveSyncRuntime(mutations: ConfigMutationCoordinator) {
    const nativeChrome = (globalThis as unknown as {chrome?: {identity?: DriveIdentity}}).chrome;
    // Safari 等宿主没有 chrome.identity；仅当构建注入的三个 Web OAuth 凭据齐全时启用网页授权路径。
    const credentialsStore = createWebOauthCredentialsStore(configStorage);
    const webOauthCredentials = isWebOauthConfigured({clientId: GOOGLE_DRIVE_WEB_CLIENT_ID, clientSecret: GOOGLE_DRIVE_WEB_CLIENT_SECRET, redirectUri: GOOGLE_DRIVE_WEB_REDIRECT_URI})
        ? {clientId: GOOGLE_DRIVE_WEB_CLIENT_ID, clientSecret: GOOGLE_DRIVE_WEB_CLIENT_SECRET, redirectUri: GOOGLE_DRIVE_WEB_REDIRECT_URI, credentials: credentialsStore}
        : undefined;
    const service = createGoogleDriveSync({
        auth: createDriveAuth({userAgent: () => navigator.userAgent, identity: nativeChrome?.identity, webOauth: webOauthCredentials, runtime: browser.runtime, fetch: (...args) => fetch(...args)}),
        api: createDriveApi((...args) => fetch(...args)),
        snapshot: prepareHydratedConfigForExport,
        async apply(value) {
            await configReady;
            const imported = prepareConfigForImport(value, config, {credentialMode: 'replace'});
            if (!imported) throw new Error('配置导入失败');
            imported.uiLanguageSetupCompleted = config.uiLanguageSetupCompleted;
            await saveConfig(imported, {recordHistory: true, immediateHistory: true});
        },
        async readState() {await configReady; return configStorage.getItem(GOOGLE_DRIVE_SYNC_STATE_KEY);},
        writeState: state => configStorage.setItem(GOOGLE_DRIVE_SYNC_STATE_KEY, state),
        now: Date.now,
    });
    browser.tabs.onRemoved.addListener((tabId: number) => {void service.cancelTab(tabId).catch(() => undefined);});
    browser.tabs.onUpdated.addListener((tabId: number, change: {status?: string}) => {if (change.status === 'loading') void service.cancelTab(tabId).catch(() => undefined);});
    // 设置页只发送授权码与 PKCE 校验值；client secret 的令牌交换与刷新令牌保存都留在本后台。
    const webOauthActions: DriveWebOauthActions | undefined = webOauthCredentials ? {
        async connect(code, codeVerifier) {
            try {
                const tokens = await exchangeWebOauthCode((...args) => fetch(...args), webOauthCredentials, code, codeVerifier);
                if (!tokens.refreshToken) throw new DriveError('Google 未返回长期授权，请重新连接 Google 账号。');
                await credentialsStore.writeRefreshToken(tokens.refreshToken);
            } catch (error) {
                if (error instanceof DriveError) throw error;
                if (error instanceof WebOauthError) throw new DriveError(error.message);
                throw new DriveError('连接 Google 账号未完成，请重试。');
            }
        },
        signOut: () => credentialsStore.clear(),
    } : undefined;
    return createGoogleDriveSyncHandler({...service, commit: (...args) => mutations.run(() => service.commit(...args))}, sender => isTrustedSettingsSender(sender, browser.runtime.id, browser.runtime.getURL('/options.html')), webOauthActions);
}
