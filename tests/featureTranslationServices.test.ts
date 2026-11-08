import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {featureServiceDefinitions, getFeatureService, getFeatureModel, setFeatureService} from '@/src/core/config/featureServices';

const feature = (id: string) => featureServiceDefinitions.find(item => item.id === id)!;
describe('按功能分配翻译服务', () => {
    it('新配置及缺失字段统一继承，持久化后切换默认服务和模型仍联动', () => {
        for (const config of [new Config(), normalizeConfig({}), normalizeConfig(JSON.parse(JSON.stringify(new Config())))]) {
            for (const item of featureServiceDefinitions) {
                expect(item.inherit).toBe(true);
                expect(getFeatureService(config, item)).toBe('');
            }
            config.service = 'openai';
            config.model.openai = customModelString;
            config.customModel.openai = 'shared-model';
            for (const item of featureServiceDefinitions) expect(getFeatureModel(config, item)).toBe('shared-model');
            config.service = 'deepseek';
            for (const item of featureServiceDefinitions) expect(getFeatureModel(config, item)).toBe(config.model.deepseek);
        }
    });
    it('各功能独立选择、跟随默认与归一化往返不改写其他服务', () => {
        const config = new Config(); config.service = 'google';
        for (const item of featureServiceDefinitions) {
            const next = item.aiOnly ? 'openai' : 'microsoft';
            setFeatureService(config, item, next);
            expect(getFeatureService(config, item)).toBe(next);
            expect(config.service).toBe('google');
        }
        const restored = normalizeConfig(JSON.parse(JSON.stringify(config)));
        for (const item of featureServiceDefinitions) expect(getFeatureService(restored, item)).toBe(getFeatureService(config, item));
        setFeatureService(restored, feature('selection'), ''); restored.service = 'openai';
        expect(getFeatureService(restored, feature('selection'))).toBe('');
        expect(getFeatureService(restored, feature('hover'))).toBe('microsoft');
    });
    it('无效、已删除服务安全回退，保留仍存在的自定义服务与旧 custom 迁移', () => {
        const invalid = normalizeConfig({hoverTranslationService: 'gone', selectionTranslationService: 42} as unknown as Partial<Config>);
        expect([invalid.hoverTranslationService, invalid.selectionTranslationService]).toEqual(['', '']);
        const valid = normalizeConfig({customOpenAIProviders: [{id: 'custom:mine', name: 'Mine', endpoint: 'http://localhost:8000/v1', models: ['local-model']}], hoverTranslationService: 'custom:mine', selectionTranslationService: 'microsoft'});
        expect([valid.hoverTranslationService, valid.selectionTranslationService]).toEqual(['custom:mine', 'microsoft']);
        const legacy = normalizeConfig({selectionTranslationService: 'custom'});
        expect(legacy.customOpenAIProviders.some(provider => provider.id === 'custom')).toBe(true);
        expect(legacy.selectionTranslationService).toBe('custom');
    });
});
