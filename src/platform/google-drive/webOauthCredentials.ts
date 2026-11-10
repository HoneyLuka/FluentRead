/**
 * @file src/platform/google-drive/webOauthCredentials.ts
 * 文件职责：把 Google Web OAuth 刷新令牌保存在后台专属加密配置仓库，并提供读取、写入与清除。
 * 主要内容：仿已删除的 WebDAV 连接存储模式——注入 ConfigStoragePort、固定 local: 键、写入前校验令牌格式、读取时拒绝损坏记录；本模块只保存刷新令牌，访问令牌只在内存中使用。
 * 模块边界：不访问网络或 Google 端点，不读取配置快照；记录独立于配置导出，刷新令牌不进入云备份或设置页。
 */
import {DriveError} from './auth';
import {isWebOauthRefreshToken} from './webOauth';
import type {ConfigStoragePort} from '@/src/platform/storage/configStorage';

export const GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY = 'local:googleDriveWebOauthCredentials';

interface StoredWebOauthCredentials {version: 1; refreshToken: string; updatedAt: number}

export function createWebOauthCredentialsStore(storage: Pick<ConfigStoragePort, 'getItem' | 'setItem' | 'removeItem'>) {
    return {
        /** 损坏的记录必须停止操作并要求重新连接，不能把无效令牌当作未登录静默刷新。 */
        async readRefreshToken(): Promise<string | null> {
            const value = await storage.getItem<StoredWebOauthCredentials>(GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY);
            if (value === null) return null;
            if (!value || typeof value !== 'object' || value.version !== 1
                || !isWebOauthRefreshToken(value.refreshToken)
                || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) {
                throw new DriveError('Google 连接记录已损坏，请退出连接后重新连接 Google 账号。');
            }
            return value.refreshToken;
        },
        async writeRefreshToken(refreshToken: string): Promise<void> {
            if (!isWebOauthRefreshToken(refreshToken)) throw new DriveError('Google 返回的长期授权无效，请重新连接。');
            await storage.setItem<StoredWebOauthCredentials>(GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY, {version: 1, refreshToken, updatedAt: Date.now()});
        },
        clear: () => storage.removeItem(GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY),
    };
}

export type WebOauthCredentialsStore = ReturnType<typeof createWebOauthCredentialsStore>;
