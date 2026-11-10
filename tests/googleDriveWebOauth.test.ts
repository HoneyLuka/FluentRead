import {describe, expect, it, vi} from 'vitest';
import {
    buildWebOauthAuthorizationUrl,
    deriveWebOauthChallenge,
    exchangeWebOauthCode,
    generateWebOauthState,
    generateWebOauthVerifier,
    isWebOauthCode,
    isWebOauthConfigured,
    isWebOauthVerifier,
    readWebOauthAuthorizationResponse,
    refreshWebOauthAccessToken,
    WebOauthError,
    type WebOauthClientCredentials,
} from '@/src/platform/google-drive/webOauth';
import {createWebOauthCredentialsStore, GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY} from '@/src/platform/google-drive/webOauthCredentials';
import {GOOGLE_DRIVE_APPLICATION_PASSPHRASE, resolveDriveSyncPassphrase} from '@/src/platform/google-drive/constants';

const credentials: WebOauthClientCredentials = {clientId: 'fixture-web-client.apps.googleusercontent.com', clientSecret: 'fixture-web-secret', redirectUri: 'https://fixture.example/oauth/callback'};
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function jsonResponse(body: unknown, status = 200) {return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});}

describe('Web OAuth PKCE 与授权 URL', () => {
    it('S256 派生使用 RFC 7636 附录 B 向量，非法校验值被拒绝', async () => {
        await expect(deriveWebOauthChallenge(verifier)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
        await expect(deriveWebOauthChallenge('short')).rejects.toMatchObject({kind: 'invalidRequest'});
        expect(isWebOauthVerifier(verifier)).toBe(true);
        for (const value of ['', 'short', 'x'.repeat(129), 'illegal char', 1, null]) expect(isWebOauthVerifier(value)).toBe(false);
        expect(isWebOauthCode('4/0Ax4Xb-valid.fixture_code')).toBe(true);
        for (const value of ['', 'a b', '?', 'x'.repeat(2049), 1]) expect(isWebOauthCode(value)).toBe(false);
    });
    it('生成的校验值与 state 符合字符集与长度要求且互不相同', async () => {
        const first = generateWebOauthVerifier();
        expect(isWebOauthVerifier(first)).toBe(true);
        expect(generateWebOauthVerifier()).not.toBe(first);
        expect(generateWebOauthState()).toMatch(/^[A-Za-z0-9_-]{32}$/u);
        expect(generateWebOauthState()).not.toBe(generateWebOauthState());
    });
    it('授权 URL 携带 offline 访问、同意并选择账号提示与唯一 Drive 范围', () => {
        const url = new URL(buildWebOauthAuthorizationUrl({clientId: credentials.clientId, redirectUri: credentials.redirectUri, codeChallenge: 'fixture-challenge', state: 'fixture-state'}));
        expect(url.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture-web-client.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Ffixture.example%2Foauth%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata&code_challenge=fixture-challenge&code_challenge_method=S256&access_type=offline&prompt=consent+select_account&state=fixture-state');
        expect(url.searchParams.get('prompt')).toBe('consent select_account');
        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    });
    it('三个凭据齐全才启用 Web 路径', () => {
        expect(isWebOauthConfigured(credentials)).toBe(true);
        expect(isWebOauthConfigured({...credentials, clientId: ''})).toBe(false);
        expect(isWebOauthConfigured({...credentials, clientSecret: ''})).toBe(false);
        expect(isWebOauthConfigured({...credentials, redirectUri: ''})).toBe(false);
        expect(isWebOauthConfigured(undefined)).toBe(false);
    });
});

describe('Web OAuth 重定向结果读取', () => {
    it('只读取回调页地址上的 code/error 与 state', () => {
        expect(readWebOauthAuthorizationResponse(`${credentials.redirectUri}?code=4%2F0Ax4Xb&state=st`, credentials.redirectUri)).toEqual({code: '4/0Ax4Xb', state: 'st'});
        expect(readWebOauthAuthorizationResponse(`${credentials.redirectUri}?error=access_denied&state=st`, credentials.redirectUri)).toEqual({error: 'access_denied', state: 'st'});
        // 其他来源与缺少结果的导航一律忽略。
        expect(readWebOauthAuthorizationResponse('https://accounts.google.com/o/oauth2/v2/auth?code=x&state=st', credentials.redirectUri)).toBeNull();
        expect(readWebOauthAuthorizationResponse('https://fixture.example/other?code=x&state=st', credentials.redirectUri)).toBeNull();
        expect(readWebOauthAuthorizationResponse(`${credentials.redirectUri}?state=st`, credentials.redirectUri)).toBeNull();
        expect(readWebOauthAuthorizationResponse(`${credentials.redirectUri}?code=x`, credentials.redirectUri)).toBeNull();
        expect(readWebOauthAuthorizationResponse('not a url', credentials.redirectUri)).toBeNull();
    });
});

describe('Web OAuth 令牌端点', () => {
    it('授权码交换发送 PKCE 校验值并接受新的刷新令牌', async () => {
        const fetch = vi.fn(async () => jsonResponse({access_token: 'at', expires_in: 3600, refresh_token: '1//fixture-refresh-token-000123'}));
        const tokens = await exchangeWebOauthCode(fetch, credentials, '4/0Ax4Xb-code', verifier);
        expect(tokens).toEqual({accessToken: 'at', expiresInSeconds: 3600, refreshToken: '1//fixture-refresh-token-000123'});
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://oauth2.googleapis.com/token');
        expect(init.method).toBe('POST');
        const body = new URLSearchParams(String(init.body));
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('4/0Ax4Xb-code');
        expect(body.get('code_verifier')).toBe(verifier);
        expect(body.get('client_id')).toBe(credentials.clientId);
        expect(body.get('client_secret')).toBe(credentials.clientSecret);
        expect(body.get('redirect_uri')).toBe(credentials.redirectUri);
    });
    it('刷新令牌端点发送 refresh_token 授权并区分失效与网络、服务错误', async () => {
        const fetch = vi.fn(async () => jsonResponse({access_token: 'at2', expires_in: 3600}));
        await expect(refreshWebOauthAccessToken(fetch, credentials, '1//fixture-refresh-token-000123')).resolves.toEqual({accessToken: 'at2', expiresInSeconds: 3600});
        const body = new URLSearchParams(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]?.body));
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('1//fixture-refresh-token-000123');
        await expect(refreshWebOauthAccessToken(fetch, credentials, 'short')).rejects.toMatchObject({kind: 'invalidGrant'});
        await expect(refreshWebOauthAccessToken(vi.fn(async () => jsonResponse({error: 'invalid_grant'}, 400)), credentials, '1//fixture-refresh-token-000123')).rejects.toMatchObject({kind: 'invalidGrant'});
        await expect(refreshWebOauthAccessToken(vi.fn(async () => {throw new Error('offline');}), credentials, '1//fixture-refresh-token-000123')).rejects.toMatchObject({kind: 'network'});
        await expect(refreshWebOauthAccessToken(vi.fn(async () => jsonResponse({error: 'backend_error'}, 503)), credentials, '1//fixture-refresh-token-000123')).rejects.toMatchObject({kind: 'server'});
        await expect(refreshWebOauthAccessToken(vi.fn(async () => jsonResponse({error: 'invalid_client'}, 401)), credentials, '1//fixture-refresh-token-000123')).rejects.toMatchObject({kind: 'invalidRequest'});
    });
    it('拒绝非法授权码与校验值，令牌响应缺少必需字段时明确失败', async () => {
        const fetch = vi.fn(async () => jsonResponse({access_token: 'at', expires_in: 3600}));
        await expect(exchangeWebOauthCode(fetch, credentials, 'bad code', verifier)).rejects.toMatchObject({kind: 'invalidRequest'});
        await expect(exchangeWebOauthCode(fetch, credentials, '4/0Ax4Xb', 'short')).rejects.toMatchObject({kind: 'invalidRequest'});
        expect(fetch).not.toHaveBeenCalled();
        for (const body of [{expires_in: 3600}, {access_token: '', expires_in: 3600}, {access_token: 'at', expires_in: 0}, {access_token: 'at', expires_in: 'x'}, {access_token: 'at'}, {}]) {
            await expect(exchangeWebOauthCode(vi.fn(async () => jsonResponse(body)), credentials, '4/0Ax4Xb', verifier)).rejects.toMatchObject({kind: 'invalidRequest'});
        }
        // 非对象或损坏 JSON 的成功响应同样无效。
        await expect(exchangeWebOauthCode(vi.fn(async () => new Response('broken', {status: 200})), credentials, '4/0Ax4Xb', verifier)).rejects.toMatchObject({kind: 'invalidRequest'});
        // 刷新令牌缺失时不伪造字段，由调用方决定是否接受。
        await expect(exchangeWebOauthCode(vi.fn(async () => jsonResponse({access_token: 'at', expires_in: 3600, refresh_token: 'short'})), credentials, '4/0Ax4Xb', verifier)).resolves.toEqual({accessToken: 'at', expiresInSeconds: 3600});
        // 非成功响应无论带流式正文还是空正文，都不阻塞错误映射。
        const streaming = vi.fn(async () => new Response(new ReadableStream({start: controller => {controller.close();}}), {status: 400}));
        await expect(exchangeWebOauthCode(streaming, credentials, '4/0Ax4Xb', verifier)).rejects.toBeInstanceOf(WebOauthError);
        await expect(exchangeWebOauthCode(vi.fn(async () => new Response(null, {status: 400})), credentials, '4/0Ax4Xb', verifier)).rejects.toMatchObject({kind: 'invalidRequest'});
    });
});

describe('Web OAuth 凭证仓库', () => {
    function store() {
        const map = new Map<string, unknown>();
        return {map, store: createWebOauthCredentialsStore({getItem: async <T>(key: string) => (map.has(key) ? map.get(key) as T : null), setItem: async <T>(key: string, value: T) => void map.set(key, value), removeItem: async (key: string) => void map.delete(key)})};
    }
    it('保存、读取并清除刷新令牌，写入前校验令牌格式', async () => {
        const f = store();
        await expect(f.store.readRefreshToken()).resolves.toBeNull();
        await f.store.writeRefreshToken('1//fixture-refresh-token-000123');
        await expect(f.store.readRefreshToken()).resolves.toBe('1//fixture-refresh-token-000123');
        expect(f.map.get(GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY)).toMatchObject({version: 1, refreshToken: '1//fixture-refresh-token-000123'});
        await f.store.clear();
        await expect(f.store.readRefreshToken()).resolves.toBeNull();
        for (const token of ['', 'short', 'x'.repeat(513), 1, null, 'illegal char']) await expect(f.store.writeRefreshToken(token as string)).rejects.toThrow('长期授权无效');
    });
    it('损坏的记录停止操作而不是被当作未登录', async () => {
        for (const value of [1, 'text', {}, {version: 2, refreshToken: '1//fixture-refresh-token-000123', updatedAt: 1}, {version: 1, refreshToken: 'bad', updatedAt: 1}, {version: 1, refreshToken: '1//fixture-refresh-token-000123', updatedAt: 'x'}, {version: 1, refreshToken: '1//fixture-refresh-token-000123'}]) {
            const f = store();
            f.map.set(GOOGLE_DRIVE_WEB_OAUTH_CREDENTIALS_KEY, value);
            await expect(f.store.readRefreshToken()).rejects.toThrow('连接记录已损坏');
        }
    });
});

describe('构建期口令注入', () => {
    it('私有口令优先，空白回落公开口令', () => {
        expect(resolveDriveSyncPassphrase('fixture-private-passphrase')).toBe('fixture-private-passphrase');
        expect(resolveDriveSyncPassphrase('')).toBe(GOOGLE_DRIVE_APPLICATION_PASSPHRASE);
        expect(resolveDriveSyncPassphrase('   ')).toBe(GOOGLE_DRIVE_APPLICATION_PASSPHRASE);
        expect(resolveDriveSyncPassphrase(undefined)).toBe(GOOGLE_DRIVE_APPLICATION_PASSPHRASE);
    });
});
