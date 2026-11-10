/**
 * @file src/services/config/googleDriveSyncClient.ts
 * 文件职责：将 Google Drive 设置页接入共用配置云备份客户端，并补充 Web OAuth 连接与退出消息。
 * 主要内容：保持现有预览、确认、取消和状态接口，使用独立的 Google Drive 消息类型；connect 只携带授权码与 PKCE 校验值，不接触 client secret 或令牌。
 * 模块边界：不读取配置、口令或令牌；所有网络与加密操作由后台完成。
 */
import {createCloudBackupClient} from './cloudBackupClient';
import type {DriveSyncStatus} from './remoteConfigSync';

const client = createCloudBackupClient('googleDriveEncryptedSync');
export const googleDriveSyncClient = {
    ...client,
    /** 设置页截获授权码后交给后台换取并保存刷新令牌；返回含登录状态的最新同步状态。 */
    connect: (code: string, codeVerifier: string) => client.request<DriveSyncStatus>('connect', {code, codeVerifier}),
    signOut: () => client.request<DriveSyncStatus>('signOut'),
};
