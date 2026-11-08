/**
 * @file src/core/config/cloudSync.ts
 * 文件职责：定义配置云备份与存储供应商之间共用的账号、会话、文件版本和安全错误契约。
 * 主要内容：账号身份隔离、强 ETag 或操作前内容核验的密文快照、只读能力和受控异常。
 * 模块边界：只声明结构和校验标识，不访问浏览器、配置存储或网络；供应商实现会话和条件写入。
 */
export class CloudSyncError extends Error {}
export interface CloudSyncAccount {id: string; email: string}
export interface CloudSyncSession {
    account: CloudSyncAccount;
    request<T>(operation: (credential: string) => Promise<T>): Promise<T>;
}
export interface CloudSyncFile {
    id: string; version: string; modifiedTime: string; etag?: string; readOnly?: true;
    /** 非标准版本标识，仅在重新核对密文后原样用于条件请求，不作为标准强 ETag。 */
    unquotedEtag?: string;
}
export interface CloudSyncRemote {file: CloudSyncFile; content: string}

/** RFC 9110 强实体标识；弱标识和自算摘要不能用于服务器版本条件。 */
export function strongCloudEtag(value: string | null | undefined): string | undefined {
    return value && value.length <= 512 && /^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value) ? value : undefined;
}

/** 内容核验仅供显式声明兼容能力的供应商使用，不代表服务器能原子阻止并发写入。 */
export function canMutateCloudFile(file: CloudSyncFile): boolean {
    return !file.readOnly && Boolean(strongCloudEtag(file.etag));
}
