/**
 * @file src/platform/google-drive/constants.ts
 * 文件职责：定义 Google Drive 同步的公开应用身份、最小权限和文件协议标识，并为自用构建提供构建期注入的 Web OAuth 凭据与私有口令。
 * 主要内容：集中商店扩展 ID、公开 OAuth Client ID、应用数据文件名与同步状态键；解析 wxt.config 注入的 FLUENTREAD_DRIVE_* 环境变量（未注入时回落公开默认值）。
 * 模块边界：只描述公开协议与构建期注入结果，不包含测试用户、登录令牌或浏览器副作用；私有口令与 Web 客户端密钥只在自用构建产物中出现，不写入源码。
 */
export const GOOGLE_DRIVE_DEFAULT_CLIENT_ID = '474699705334-7fua4hnkq1nmfu92cof0kdnmqsk5kth8.apps.googleusercontent.com';
export const GOOGLE_DRIVE_EXTENSION_ID = 'djnlaiohfaaifbibleebjggkghlmcpcj';
export const GOOGLE_DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata',
] as const;
export const GOOGLE_DRIVE_CONFIG_FILE_NAME = 'fluentread-config.encrypted.json';
export const GOOGLE_DRIVE_SYNC_STATE_KEY = 'local:googleDriveEncryptedSyncState';
// 配置 JSON 与云端密文分开预算；预览只额外包含少量账号和期限元数据。
export const GOOGLE_DRIVE_MAX_CONFIG_BYTES = 20 * 1024 * 1024;
export const GOOGLE_DRIVE_MAX_PREVIEW_BYTES = GOOGLE_DRIVE_MAX_CONFIG_BYTES + 1024 * 1024;
export const GOOGLE_DRIVE_MAX_BYTES = 32 * 1024 * 1024;


// Chrome 商店 CRX 签名中的公开公钥；SHA-256 前 16 字节对应上方官方扩展 ID。
export const GOOGLE_DRIVE_EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzyYQdG/K1kp2h+orQITmCJYrUP3FkUgay+KYlUMO74J0uaOBJ0A2lz0kooci0epVm3DKIqiFMQs8g5pGxKfwieLYju4/v6jK4X3AnRH+3Wj0WhnY0yMD61IN/HissrFnmBTfApW7BoVfjUUwhsHJ7pYJHMhgpbidJ15SA7X82iRpu+WxE413BKSi2q6TwNSgi7D1Vq6W9Iuaz1tPQW9CGgfir3P5enUqUasLv6icLVXq5xduFISrsJxZW0dJyGxpwOqEBGbg2g9i73M/iFao7N7pZdBvZJh63ZzlZTNM7FshCzkZpM0MJhuJhrLmR1AYCWQ1kiTfwCX+6EvAgBQyrQIDAQAB';

// 固定应用口令是公开的格式兼容参数；拿到密文的人可以据此解密，访问保护依赖 Google 授权。
export const GOOGLE_DRIVE_APPLICATION_PASSPHRASE = 'FluentReadEncryption';

// wxt.config.ts 的 vite.define 在构建期把 FLUENTREAD_DRIVE_PASSPHRASE 静态替换进产物；
// 测试与未配置构建直接读取运行时 process.env（undefined 时回落公开口令，与官方版行为一致）。
export function resolveDriveSyncPassphrase(injected: string | undefined = process.env.FLUENTREAD_DRIVE_PASSPHRASE): string {
    return injected && injected.trim() ? injected : GOOGLE_DRIVE_APPLICATION_PASSPHRASE;
}

// 自用精简版私有口令：未注入时与官方扩展相同，旧备份保持可读。
export const GOOGLE_DRIVE_SYNC_PASSPHRASE = resolveDriveSyncPassphrase();

// Safari 等无 chrome.identity 的宿主走 Web OAuth（uBlacklist 式网页授权）。
// 三个值均由 wxt.config.ts 从 FLUENTREAD_DRIVE_WEB_* 环境变量注入；未注入时为空串，Web 路径保持不可用。
export const GOOGLE_DRIVE_WEB_CLIENT_ID = process.env.FLUENTREAD_DRIVE_WEB_CLIENT_ID ?? '';
export const GOOGLE_DRIVE_WEB_CLIENT_SECRET = process.env.FLUENTREAD_DRIVE_WEB_CLIENT_SECRET ?? '';
export const GOOGLE_DRIVE_WEB_REDIRECT_URI = process.env.FLUENTREAD_DRIVE_WEB_REDIRECT_URI ?? '';
