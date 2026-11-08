import {describe, expect, it} from 'vitest';

import {
    CONFIG_AUTO_BACKUP_LIMIT,
    appendConfigAutoBackup,
    cloneConfigAutoBackups,
    createBaselineConfigAutoBackups,
    findConfigAutoBackup,
    parseConfigAutoBackups,
    serializeConfigAutoBackups,
} from '@/src/services/config/autoBackup';

const baseConfig = {
    on: true,
    service: 'openai',
    from: 'auto',
    to: 'zh-Hans',
};

describe('自动配置备份纯状态机', () => {
    it('首次创建脱敏且不可变的基线', () => {
        const baseline = createBaselineConfigAutoBackups({
            ...baseConfig,
            hoverTranslationService: 'google',
            deeplApiPlan: 'pro',
            token: {openai: 'secret'},
            count: 9,
            persistCredentials: true,
        }, 'baseline-time');

        expect(baseline).toMatchObject({
            schemaVersion: 1,
            entries: [{version: 1, savedAt: 'baseline-time', config: {to: 'zh-Hans'}}],
            nextVersion: 2,
        });
        expect(baseline.entries[0]?.config).not.toHaveProperty('token');
        expect(baseline.entries[0]?.config).not.toHaveProperty('count');
        expect(baseline.entries[0]?.config).not.toHaveProperty('persistCredentials');
        expect(baseline.entries[0]?.config.hoverTranslationService).toBe('google');
        expect(baseline.entries[0]?.config.deeplApiPlan).toBe('pro');

        const cloned = cloneConfigAutoBackups(baseline);
        expect(cloned).not.toBe(baseline);
        expect(cloned.entries[0]).not.toBe(baseline.entries[0]);
        expect(cloned.entries[0]?.config.hoverTranslationService).toBe('google');
        expect(parseConfigAutoBackups(JSON.parse(serializeConfigAutoBackups(cloned)))?.entries[0]?.config.deeplApiPlan)
            .toBe('pro');
        expect(serializeConfigAutoBackups(cloned)).toBe(JSON.stringify(cloned));
    });

    it('每次周期都追加检查点，即使配置未变化，并限制最近十份', () => {
        let state = createBaselineConfigAutoBackups(baseConfig, 'time-0');
        for (let index = 1; index <= 12; index += 1) {
            state = appendConfigAutoBackup(state, baseConfig, `time-${index}`);
        }

        expect(state.entries).toHaveLength(CONFIG_AUTO_BACKUP_LIMIT);
        expect(state.entries[0]).toMatchObject({version: 4, savedAt: 'time-3'});
        expect(state.entries.at(-1)).toMatchObject({version: 13, savedAt: 'time-12'});
        expect(state.nextVersion).toBe(14);
        expect(findConfigAutoBackup(state, 13)?.savedAt).toBe('time-12');
        expect(findConfigAutoBackup(state, 1)).toBeNull();
    });

    it('解析时过滤损坏条目、迁移旧快照投影并修正 nextVersion', () => {
        const parsed = parseConfigAutoBackups({
            schemaVersion: 1,
            entries: [
                null,
                {version: 'bad'},
                ...Array.from({length: 12}, (_, index) => ({
                    version: index + 1,
                    savedAt: `time-${index + 1}`,
                    config: {
                        ...baseConfig,
                        to: `target-${index + 1}`,
                        token: {openai: 'legacy-secret'},
                        count: index,
                        persistCredentials: true,
                    },
                })),
            ],
            nextVersion: 2,
        });

        expect(parsed?.entries).toHaveLength(CONFIG_AUTO_BACKUP_LIMIT);
        expect(parsed?.entries[0]?.version).toBe(3);
        expect(parsed?.entries.at(-1)?.version).toBe(12);
        expect(parsed?.nextVersion).toBe(13);
        expect(JSON.stringify(parsed)).not.toContain('legacy-secret');
        expect(parsed?.entries[0]?.config).not.toHaveProperty('count');
        expect(parsed?.entries[0]?.config).not.toHaveProperty('persistCredentials');

        const defaultVersion = parseConfigAutoBackups({
            entries: [{version: 1, savedAt: 'time', config: baseConfig}],
        });
        expect(defaultVersion?.nextVersion).toBe(2);
        const retainedVersion = parseConfigAutoBackups({
            entries: [{version: 1, savedAt: 'time', config: baseConfig}],
            nextVersion: 20,
        });
        expect(retainedVersion?.nextVersion).toBe(20);

        expect(parseConfigAutoBackups(null)).toBeNull();
        expect(parseConfigAutoBackups({schemaVersion: 2, entries: []})).toBeNull();
        expect(parseConfigAutoBackups({entries: [{version: 1, savedAt: 'x', config: {on: true}}]})).toBeNull();
    });
});
