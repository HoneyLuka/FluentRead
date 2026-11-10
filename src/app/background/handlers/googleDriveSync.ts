/**
 * @file src/app/background/handlers/googleDriveSync.ts
 * 文件职责：将加密同步与备份删除协议限制在扩展设置页面的可信消息边界，并为 Web OAuth 路径提供连接与退出动作。
 * 主要内容：校验发送者、同步或删除动作、预览 ID 与冲突选择，自动使用构建期注入的同步口令（未注入时回落公开口令）；connect 用设置页截获的授权码加 PKCE 校验值换取并保存刷新令牌，signOut 清除本机连接记录；上传完成但未核验时返回可本地化的提示，屏蔽外部异常原文。
 * 模块边界：不读取配置或访问令牌；依赖服务执行同步，返回值仅含状态与隐藏内容的预览。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import type {ConfigPersistenceContext} from './configPersistence';
import type {createGoogleDriveSync} from '@/src/services/config/googleDriveSync';
import {GOOGLE_DRIVE_SYNC_PASSPHRASE} from '@/src/platform/google-drive/constants';
import {isWebOauthCode, isWebOauthVerifier} from '@/src/platform/google-drive/webOauth';
import {DriveError} from '@/src/platform/google-drive/auth';
import {DriveUploadVerificationError} from '@/src/platform/google-drive/api';
import {DriveEncryptionError} from '@/src/platform/google-drive/encryption';
import {CloudSyncError} from '@/src/core/config/cloudSync';
import {DriveConfigError} from '@/src/core/config/driveSync';

export const GOOGLE_DRIVE_SYNC_MESSAGE_TYPE = 'googleDriveEncryptedSync';
export interface DriveSyncMessage {type: typeof GOOGLE_DRIVE_SYNC_MESSAGE_TYPE; action?: unknown; clientId?: unknown; id?: unknown; direction?: unknown; includeSensitive?: unknown; choices?: unknown; code?: unknown; codeVerifier?: unknown}
type Service = ReturnType<typeof createGoogleDriveSync>;
/** Web OAuth 连接动作端口：由后台 runtime 装配令牌交换与凭证存储，handler 只做协议校验。 */
export interface DriveWebOauthActions {
    connect(code: string, codeVerifier: string): Promise<void>;
    signOut(): Promise<void>;
}
export function createGoogleDriveSyncHandler(service: Service, trusted: (sender: ConfigPersistenceContext['sender']) => boolean, webOauth?: DriveWebOauthActions): BackgroundMessageHandler<ConfigPersistenceContext, DriveSyncMessage> {
    return {
        type: GOOGLE_DRIVE_SYNC_MESSAGE_TYPE,
        async handle(message, context) {
            if (!trusted(context.sender)) return {success: false, error: 'Google Drive 同步仅允许从扩展设置页面操作。'};
            try {
                let data: unknown;
                const tabId = context.sender?.tab?.id;
                if (message.action !== 'status' && (typeof message.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/u.test(message.clientId))) return {success: false, error: '无效的 Google Drive 同步操作。'};
                const clientId = message.clientId as string;
                if (message.action === 'status') data = await service.status();
                else if (message.action === 'connect') {
                    if (!webOauth) return {success: false, error: '当前构建未配置 Google 网页授权，请在 Chrome 中使用系统授权或按维护者指南配置。'};
                    if (!isWebOauthCode(message.code) || !isWebOauthVerifier(message.codeVerifier)) return {success: false, error: '无效的 Google 授权结果，请重新连接。'};
                    await webOauth.connect(message.code, message.codeVerifier);
                    data = await service.status();
                } else if (message.action === 'signOut') {
                    if (!webOauth) return {success: false, error: '当前浏览器使用系统授权管理 Google 连接，无需退出。'};
                    await webOauth.signOut();
                    data = await service.status();
                }
                else if (message.action === 'prepareDelete') data = await service.prepareDelete(tabId, clientId);
                else if (message.action === 'commitDelete' && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 64) data = await service.commitDelete(message.id, tabId, clientId);
                else if (message.action === 'cancel' && (message.id === undefined || (typeof message.id === 'string' && message.id.length <= 64))) data = await service.cancel(message.id as string | undefined, tabId, clientId);
                else if (message.action === 'prepare' && (message.includeSensitive === undefined || typeof message.includeSensitive === 'boolean')) data = await service.prepare(GOOGLE_DRIVE_SYNC_PASSPHRASE, tabId, clientId, message.includeSensitive ?? false);
                else if (message.action === 'commit' && typeof message.id === 'string' && message.id.length <= 64 && ['upload', 'download', 'merge'].includes(message.direction as string)) {
                    const choices = message.choices;
                    if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length > 50_000 || !Object.entries(choices).every(([key, value]) => /^\d+$/u.test(key) && (value === 'local' || value === 'remote'))) return {success: false, error: '无效的同步差异选择。'};
                    data = await service.commit(message.id, GOOGLE_DRIVE_SYNC_PASSPHRASE, message.direction as 'upload' | 'download' | 'merge', choices as Record<string, unknown>, tabId, clientId);
                } else return {success: false, error: '无效的 Google Drive 同步操作。'};
                return {success: true, data};
            } catch (error) {
                if (error instanceof DriveUploadVerificationError) return {success: false, error: error.message, errorKey: 'settings.cloud.uploadUnverified'};
                if (error instanceof DriveError && (message.action === 'connect' || message.action === 'signOut')) return {success: false, error: error.message};
                return {success: false, error: error instanceof DriveEncryptionError ? error.message === '同步配置过大，请减少自定义设置后重试' ? error.message : '同步文件无法解密或已损坏；请检查云端备份，本机配置未被修改。' : error instanceof DriveError || error instanceof CloudSyncError || error instanceof DriveConfigError ? error.message : message.action === 'connect' || message.action === 'signOut' ? '连接 Google 账号未完成，请重试。' : '同步未完成，请检查网络和配置存储后重新预览。'};
            }
        },
    };
}
