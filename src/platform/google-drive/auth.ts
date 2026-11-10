/**
 * @file src/platform/google-drive/auth.ts
 * 文件职责：连接 Chrome 原生身份 API 或构建期注入的 Google Web OAuth，并将一次同步绑定到同一个 Google 账号。
 * 主要内容：原生/Web 双路径可用性判定、单项 Drive 授权、Web 路径 PKCE 刷新令牌换发（60 秒提前过期）、Drive 账号识别、短期令牌刷新与账号切换保护。
 * 模块边界：不保存令牌、不读取配置；账号和令牌只在后台请求期间使用；Web 刷新令牌由调用方注入的凭证仓库保管，客户端密钥不进入设置页。
 */
import {cancelUnreadResponseBody} from '@/src/platform/http/runtime';
import {GOOGLE_DRIVE_DEFAULT_CLIENT_ID, GOOGLE_DRIVE_EXTENSION_ID, GOOGLE_DRIVE_SCOPES} from './constants';
import {isWebOauthConfigured, refreshWebOauthAccessToken, WebOauthError, type WebOauthClientCredentials} from './webOauth';

// 邮箱仅用于预览展示；账号绑定始终使用 Drive permissionId，不依赖邮箱或额外身份授权。
export interface DriveAccount {id: string; email: string}
export interface DriveSession {
    account: DriveAccount;
    request<T>(operation: (token: string) => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface DriveIdentity {
    getAuthToken(details: {interactive: boolean; enableGranularPermissions: boolean; scopes: string[]}): Promise<{token?: string; grantedScopes?: string[]}>;
    removeCachedAuthToken(details: {token: string}): Promise<void>;
    clearAllCachedAuthTokens(): Promise<void>;
}
export class DriveError extends Error {
    constructor(message: string, readonly status?: number) {super(message); this.name = 'DriveError';}
}
/** Web OAuth 路径的状态快照：设置页据此展示连接/退出入口，客户端密钥不包含在内。 */
export interface DriveWebOauthStatus {clientId: string; redirectUri: string; signedIn: boolean}
export interface DriveAuthAvailability {available: boolean; reason: string; webOauth?: DriveWebOauthStatus}
export interface DriveWebOauthPorts extends WebOauthClientCredentials {
    credentials: {readRefreshToken(): Promise<string | null>; writeRefreshToken(refreshToken: string): Promise<void>; clear(): Promise<void>};
}
export interface DriveAuthPorts {
    userAgent(): string;
    identity?: DriveIdentity;
    /** 无原生 identity（Safari 等）且构建注入凭据齐全时启用的 Web OAuth 端口。 */
    webOauth?: DriveWebOauthPorts;
    runtime: {id: string; getManifest(): {oauth2?: {client_id?: string; scopes?: string[]}}};
    fetch: typeof fetch;
}

/**
 * Web OAuth 身份：实现与 chrome.identity 相同的 DriveIdentity 语义。
 * 访问令牌只缓存在内存并提前 60 秒过期；刷新令牌来自注入的凭证仓库，invalid_grant 时清除凭证并要求重新连接。
 * clearAllCachedAuthTokens 只清内存缓存（操作结束的自动清理），持久退出连接由 signOut 显式完成。
 */
export function createWebDriveIdentity(webOauth: DriveWebOauthPorts, fetcher: typeof fetch): DriveIdentity {
    let cached: {token: string; expiresAt: number} | null = null;
    return {
        async getAuthToken(details) {
            if (cached && cached.expiresAt - 60_000 > Date.now()) return {token: cached.token, grantedScopes: [...GOOGLE_DRIVE_SCOPES]};
            const refreshToken = await webOauth.credentials.readRefreshToken();
            if (!refreshToken) throw new DriveError(details.interactive ? '请先连接 Google 账号，再进行 Google Drive 同步。' : 'Google 授权已失效，请重新连接 Google 账号。');
            try {
                const tokens = await refreshWebOauthAccessToken(fetcher, webOauth, refreshToken);
                cached = {token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresInSeconds * 1000};
                return {token: tokens.accessToken, grantedScopes: [...GOOGLE_DRIVE_SCOPES]};
            } catch (error) {
                if (error instanceof WebOauthError && error.kind === 'invalidGrant') {
                    await webOauth.credentials.clear();
                    throw new DriveError('Google 授权已失效，请重新连接 Google 账号。');
                }
                // 网络与服务端错误映射为安全提示；刷新令牌端点的其余失败不区分来源。
                throw new DriveError(error instanceof WebOauthError ? error.message : '无法连接 Google 授权服务，请检查网络后重试。');
            }
        },
        async removeCachedAuthToken(details) {if (cached?.token === details.token) cached = null;},
        async clearAllCachedAuthTokens() {cached = null;},
    };
}

export function createDriveAuth(ports: DriveAuthPorts) {
    // Native identity cannot be cancelled. A late token must be cleared before
    // another authorization can use the same browser cache.
    const abandonedIdentities = new Set<Promise<void>>();
    let abandonedCleanupFailed = false;
    // 原生 identity 优先；缺失时（Safari 等）回落到构建期注入的 Web OAuth 身份，两者共用下方会话与 401 重放逻辑。
    // 端口对象可能被调用方在构造后替换 identity，按次解析；Web 身份的内存令牌缓存只创建一次。
    let webIdentity: DriveIdentity | null = null;
    const resolveIdentity = (): DriveIdentity | undefined => {
        if (ports.identity?.getAuthToken) return ports.identity;
        if (!webIdentity && isWebOauthConfigured(ports.webOauth)) webIdentity = createWebDriveIdentity(ports.webOauth, ports.fetch);
        return webIdentity ?? undefined;
    };
    const nativeIdentity = () => Boolean(ports.identity?.getAuthToken);
    const waitForSignal = <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
        if (!signal) return operation;
        return new Promise((resolve, reject) => {
            const abort = () => {signal.removeEventListener('abort', abort); reject(signal.reason);};
            signal.addEventListener('abort', abort, {once: true});
            operation.then(value => {signal.removeEventListener('abort', abort); resolve(value);}, error => {signal.removeEventListener('abort', abort); reject(error);});
            if (signal.aborted) abort();
        });
    };
    async function availability(): Promise<DriveAuthAvailability> {
        const oauth = ports.runtime.getManifest().oauth2;
        const hasNativeIdentity = nativeIdentity();
        if (hasNativeIdentity && /\bChrome\//u.test(ports.userAgent()) && !/\b(?:Edg|OPR)\//u.test(ports.userAgent()) && oauth?.client_id) {
            if (oauth.client_id === GOOGLE_DRIVE_DEFAULT_CLIENT_ID && ports.runtime.id !== GOOGLE_DRIVE_EXTENSION_ID) return {available: false, reason: '当前开发版扩展 ID 与 Google OAuth 客户端不匹配，请按维护者指南设置扩展公钥或单独创建开发客户端。'};
            if (!GOOGLE_DRIVE_SCOPES.every(scope => oauth.scopes?.includes(scope))) return {available: false, reason: '扩展缺少 Google Drive 应用数据授权范围，请重新构建。'};
            return {available: true, reason: ''};
        }
        if (!hasNativeIdentity && isWebOauthConfigured(ports.webOauth)) {
            // 损坏的连接记录按未登录展示，由下一次连接覆盖；实际令牌读取路径仍会抛出明确错误。
            let signedIn = false;
            try {signedIn = Boolean(await ports.webOauth.credentials.readRefreshToken());} catch {signedIn = false;}
            return {available: true, reason: '', webOauth: {clientId: ports.webOauth.clientId, redirectUri: ports.webOauth.redirectUri, signedIn}};
        }
        return {available: false, reason: 'Google Drive 同步目前支持 Chrome 扩展；其他浏览器可使用下方完整数据备份。'};
    }
    async function token(interactive: boolean, signal?: AbortSignal): Promise<string> {
        const state = await availability();
        if (!state.available) throw new DriveError(state.reason);
        if (abandonedIdentities.size || abandonedCleanupFailed) throw new DriveError('上次 Google 授权仍在结束，请稍后重试。');
        signal?.throwIfAborted();
        const identity = resolveIdentity();
        const request = Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return identity!.getAuthToken({interactive, enableGranularPermissions: true, scopes: [...GOOGLE_DRIVE_SCOPES]});
        });
        let result: Awaited<ReturnType<DriveIdentity['getAuthToken']>>;
        const quarantine = () => {
            const cleanup = request.then(async late => {if (late.token) await identity!.removeCachedAuthToken({token: late.token});}, () => undefined)
                .catch(() => {abandonedCleanupFailed = true;});
            abandonedIdentities.add(cleanup);
            void cleanup.then(() => {abandonedIdentities.delete(cleanup);});
        };
        const abort = () => {quarantine();};
        signal?.addEventListener('abort', abort, {once: true});
        try {
            result = await waitForSignal(request, signal);
            signal?.throwIfAborted();
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            // Web 路径的 getAuthToken 抛出的 DriveError 已是面向用户的安全提示，直接透出；原生路径的内部错误仍统一遮蔽。
            if (error instanceof DriveError) throw error;
            throw new DriveError('Google 授权未完成，请点击同步按钮后重试。');
        } finally {signal?.removeEventListener('abort', abort);}
        if (!result.token) throw new DriveError('Google 未返回有效授权，请点击同步按钮重试。');
        if (result.grantedScopes && !result.grantedScopes.includes(GOOGLE_DRIVE_SCOPES[0])) throw new DriveError('未允许 Google Drive 配置数据权限，请重新同步并在 Google 授权页面允许访问配置数据。');
        return result.token;
    }
    async function evictToken(accessToken: string, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        const identity = resolveIdentity();
        const operation = Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return identity!.removeCachedAuthToken({token: accessToken});
        });
        const abort = () => {
            const cleanup = operation.catch(() => {abandonedCleanupFailed = true;});
            abandonedIdentities.add(cleanup);
            void cleanup.then(() => {abandonedIdentities.delete(cleanup);});
        };
        signal?.addEventListener('abort', abort, {once: true});
        try {
            await waitForSignal(operation, signal);
            signal?.throwIfAborted();
        } finally {signal?.removeEventListener('abort', abort);}
    }
    async function account(accessToken: string, signal?: AbortSignal): Promise<DriveAccount> {
        signal?.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(() => controller.abort(), 30_000);
        const operation = (async () => {
            let response: Response | undefined;
            try {
                response = await ports.fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)', {headers: {Authorization: `Bearer ${accessToken}`}, signal: controller.signal});
                if (!response.ok) throw new DriveError(`读取 Google 账号失败（HTTP ${response.status}）。`, response.status);
                const data: unknown = await response.json();
                const user = data && typeof data === 'object' && 'user' in data ? data.user : null;
                if (!user || typeof user !== 'object' || !('permissionId' in user) || typeof user.permissionId !== 'string' || !user.permissionId) throw new DriveError('Google 账号响应无效，请重新同步。');
                // 与旧 OAuth 身份 ID 分开命名，旧基线回到明确选方向的首次同步，不能按邮箱冒认同一账号。
                return {id: `drive:${user.permissionId}`, email: 'emailAddress' in user && typeof user.emailAddress === 'string' ? user.emailAddress : ''};
            } finally {
                if (response) cancelUnreadResponseBody(response);
            }
        })();
        return waitForSignal(operation, signal).catch(error => {
            if (signal?.aborted) throw signal.reason;
            if (error instanceof DriveError) throw error;
            throw new DriveError('无法读取 Google 账号，请检查网络后重试。');
        }).finally(() => {clearTimeout(timer); signal?.removeEventListener('abort', abort);});
    }
    async function open(interactive = false, signal?: AbortSignal): Promise<DriveSession> {
        let accessToken = await token(interactive, signal);
        let owner: DriveAccount;
        try {owner = await account(accessToken, signal);} catch (error) {
            signal?.throwIfAborted();
            if (!(error instanceof DriveError) || error.status !== 401) throw error;
            await evictToken(accessToken, signal);
            accessToken = await token(false, signal);
            owner = await account(accessToken, signal);
        }
        return {
            account: owner,
            async request(operation, requestSignal) {
                requestSignal?.throwIfAborted();
                const requestToken = accessToken;
                try {return await operation(requestToken);} catch (error) {
                    requestSignal?.throwIfAborted();
                    if (!(error instanceof DriveError) || error.status !== 401) throw error;
                    await evictToken(requestToken, requestSignal);
                    const refreshedToken = await token(false, requestSignal);
                    const refreshed = await account(refreshedToken, requestSignal);
                    if (refreshed.id !== owner.id) throw new DriveError('Google 账号已切换，请重新生成同步预览。');
                    // 只有验证属于本会话账号的令牌才可成为后续请求的凭据。
                    accessToken = refreshedToken;
                    return operation(refreshedToken);
                }
            },
        };
    }
    async function disconnect() {
        const identity = resolveIdentity();
        if (identity) {
            // Web 路径只清内存访问令牌缓存，保留刷新令牌供下次同步静默换发；持久退出连接走 signOut。
            await identity.clearAllCachedAuthTokens();
            if (!abandonedIdentities.size) abandonedCleanupFailed = false;
        }
    }
    return {availability, open, disconnect};
}
