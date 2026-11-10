/**
 * @file src/platform/google-drive/webOauth.ts
 * 文件职责：实现 Safari 等无 chrome.identity 宿主使用的 Google Web OAuth 纯协议（uBlacklist 式网页授权）。
 * 主要内容：PKCE S256 校验值派生、带 offline 访问与账号选择的授权 URL 构造、重定向 URL 的授权结果读取、授权码交换与刷新令牌访问（fetch 由调用方注入，错误区分刷新失效）。
 * 模块边界：只做编码、URL 与令牌端点协议，不访问浏览器、存储或配置；client secret 由后台调用方传入，不进入设置页。
 */

// Google Web OAuth 端点与 Drive 应用数据范围；与 Chrome 原生 identity 路径请求同一 scope。
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// RFC 7636：校验值为 43-128 位 unreserved 字符；Google 授权码与刷新令牌（如 4/0Ax…、1//09…）额外包含斜杠。
const VERIFIER_PATTERN = /^[A-Za-z0-9-._~]{43,128}$/u;
const CODE_PATTERN = /^[A-Za-z0-9/._~-]{1,2048}$/u;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9/_-]{20,512}$/u;

export class WebOauthError extends Error {
    constructor(message: string, readonly kind: 'invalidRequest' | 'invalidGrant' | 'server' | 'network') {super(message); this.name = 'WebOauthError';}
}

export interface WebOauthClientCredentials {clientId: string; clientSecret: string; redirectUri: string}

/** 三个构建期注入值齐全时 Web OAuth 路径才可用；任一缺失都不能发起授权。 */
export function isWebOauthConfigured(credentials: Partial<WebOauthClientCredentials> | undefined): credentials is WebOauthClientCredentials {
    return Boolean(credentials && credentials.clientId && credentials.clientSecret && credentials.redirectUri);
}

export function isWebOauthVerifier(value: unknown): value is string {
    return typeof value === 'string' && VERIFIER_PATTERN.test(value);
}

export function isWebOauthCode(value: unknown): value is string {
    return typeof value === 'string' && CODE_PATTERN.test(value);
}

/** 刷新令牌格式校验同时供凭证仓库在写入前拒绝无效值。 */
export function isWebOauthRefreshToken(value: unknown): value is string {
    return typeof value === 'string' && REFRESH_TOKEN_PATTERN.test(value);
}

function randomUrlSafe(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** 32 字节随机数编码为 43 字符 base64url，正好满足 PKCE 校验值下限。 */
export function generateWebOauthVerifier(): string {
    return randomUrlSafe(32);
}

export function generateWebOauthState(): string {
    return randomUrlSafe(24);
}

/** S256：校验值 SHA-256 后 base64url 去填充，不带填充符合 Google 端点要求。 */
export async function deriveWebOauthChallenge(verifier: string): Promise<string> {
    if (!isWebOauthVerifier(verifier)) throw new WebOauthError('PKCE 校验值无效。', 'invalidRequest');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** access_type=offline 每次换发刷新令牌；prompt=consent select_account 保证重新选择账号并返回 refresh_token。 */
export function buildWebOauthAuthorizationUrl(params: {clientId: string; redirectUri: string; codeChallenge: string; state: string}): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.appdata');
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('state', params.state);
    return url.href;
}

export type WebOauthAuthorizationResult = {code: string; state: string} | {error: string; state: string}

/**
 * 只有落在受信任 redirect_uri 前缀下的地址才读取结果；其他页签导航一律忽略。
 * Google 重定向使用查询参数（response_mode 未启用 fragment）。
 */
export function readWebOauthAuthorizationResponse(url: string, redirectUri: string): WebOauthAuthorizationResult | null {
    let parsed: URL;
    try {parsed = new URL(url);} catch {return null;}
    const allowed = new URL(redirectUri);
    if (parsed.origin !== allowed.origin || !parsed.pathname.startsWith(allowed.pathname)) return null;
    const state = parsed.searchParams.get('state');
    if (typeof state !== 'string' || !state) return null;
    const code = parsed.searchParams.get('code');
    if (code) return {code, state};
    const error = parsed.searchParams.get('error');
    if (error) return {error, state};
    return null;
}

export interface WebOauthTokens {accessToken: string; expiresInSeconds: number; refreshToken?: string}

async function requestTokens(fetcher: typeof fetch, credentials: WebOauthClientCredentials, grant: Record<string, string>): Promise<WebOauthTokens> {
    // Google 令牌端点只接受 snake_case 表单字段；client_id/client_secret 对两种授权共用。
    const body = new URLSearchParams({client_id: credentials.clientId, client_secret: credentials.clientSecret, ...grant});
    let response: Response;
    try {
        response = await fetcher(TOKEN_ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body});
    } catch {
        throw new WebOauthError('无法连接 Google 授权服务，请检查网络后重试。', 'network');
    }
    let data: unknown = null;
    try {data = await response.json();} catch {await response.body?.cancel().catch(() => undefined);}
    const payload = data && typeof data === 'object' ? data as Record<string, unknown> : null;
    if (!response.ok || !payload) {
        const error = typeof payload?.error === 'string' ? payload.error : '';
        if (error === 'invalid_grant') throw new WebOauthError('Google 授权已失效，请重新连接 Google 账号。', 'invalidGrant');
        if (response.status >= 500) throw new WebOauthError('Google 授权服务暂时不可用，请稍后重试。', 'server');
        throw new WebOauthError('Google 授权请求被拒绝，请检查客户端配置后重试。', 'invalidRequest');
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token || typeof payload.expires_in !== 'number' || !(payload.expires_in > 0)) {
        throw new WebOauthError('Google 授权响应无效，请重试。', 'invalidRequest');
    }
    const refreshToken = payload.refresh_token;
    return {accessToken: payload.access_token, expiresInSeconds: payload.expires_in, ...(isWebOauthRefreshToken(refreshToken) ? {refreshToken} : {})};
}

/** 用设置页截获的授权码换取令牌；prompt=consent 下 Google 应始终返回新的 refresh_token。 */
export async function exchangeWebOauthCode(fetcher: typeof fetch, credentials: WebOauthClientCredentials, code: string, codeVerifier: string): Promise<WebOauthTokens> {
    if (!isWebOauthCode(code) || !isWebOauthVerifier(codeVerifier)) throw new WebOauthError('Google 授权码或 PKCE 校验值无效。', 'invalidRequest');
    return requestTokens(fetcher, credentials, {grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: credentials.redirectUri});
}

/** 刷新访问令牌；invalid_grant 映射为 invalidGrant 供调用方清除失效凭证并要求重新连接。 */
export async function refreshWebOauthAccessToken(fetcher: typeof fetch, credentials: WebOauthClientCredentials, refreshToken: string): Promise<WebOauthTokens> {
    if (!isWebOauthRefreshToken(refreshToken)) throw new WebOauthError('Google 刷新令牌无效，请重新连接 Google 账号。', 'invalidGrant');
    return requestTokens(fetcher, credentials, {grant_type: 'refresh_token', refresh_token: refreshToken});
}
