/**
 * @file tests/configApiKeys.test.ts
 * 文件职责：验证多 API Key 配置的规范化、旧 token 迁移、兼容镜像与空行语义。
 * 主要内容：覆盖逗号 key、顺序、空行、显式清空以及 Config 归一化往返；用真实 Vue computed/effect 验证首次添加、替换、删除、迁移优先级和单服务依赖边界。
 * 模块边界：调用实际 core 配置与身份函数，不替换身份算法，不访问浏览器存储或真实 provider。
 */

import {describe, expect, it} from 'vitest';
import {computed, effect, reactive, stop} from 'vue';
import {apiKeysToToken, getServiceApiKeyRows, getServiceApiKeys, normalizeApiKeys} from '@/src/core/config/apiKeys';
import {createApiKeyCheckRevision} from '@/src/core/config/apiKeyCheckIdentity';
import {normalizeConfig} from '@/src/core/config/model';

describe('多 API Key 配置', () => {
    it('保留顺序、空行和逗号，不把 key 拆成多个值', () => {
        const apiKeys = normalizeApiKeys({openai: [' first ', '', 'a,b', 42, ' second ']});
        expect(apiKeys).toEqual({openai: ['first', '', 'a,b', 'second']});
        expect(getServiceApiKeyRows({apiKeys}, 'openai')).toEqual(['first', '', 'a,b', 'second']);
        expect(getServiceApiKeys({apiKeys}, 'openai')).toEqual(['first', 'a,b', 'second']);
    });

    it('旧 token 迁移为单 key，新列表优先且显式空列表清空', () => {
        expect(normalizeConfig({token: {openai: 'legacy,key'}}).apiKeys).toEqual({openai: ['legacy,key']});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: ['new-1', 'new-2']}}))
            .toMatchObject({apiKeys: {openai: ['new-1', 'new-2']}, token: {openai: 'new-1'}});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: []}}))
            .toMatchObject({apiKeys: {openai: []}, token: {}});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: ['']}}))
            .toMatchObject({apiKeys: {openai: ['']}, token: {}});
    });

    it('兼容读取缺失新字段并生成首个非空 token', () => {
        expect(normalizeApiKeys(null)).toEqual({});
        expect(normalizeApiKeys({openai: 'not-an-array'})).toEqual({});
        expect(getServiceApiKeys({token: {openai: 'legacy'}}, 'openai')).toEqual(['legacy']);
        expect(getServiceApiKeyRows({apiKeys: null, token: {openai: 'legacy'}}, 'openai')).toEqual(['legacy']);
        expect(getServiceApiKeys({token: {openai: 42}}, 'openai')).toEqual([]);
        expect(getServiceApiKeys({token: {openai: '  '}}, 'openai')).toEqual([]);
        expect(getServiceApiKeys({apiKeys: {openai: ['a', 'a', '']}, token: {openai: 'legacy'}}, 'openai'))
            .toEqual(['a']);
        expect(apiKeysToToken({openai: ['', 'second'], deepseek: ['first', 'second']}))
            .toEqual({openai: 'second', deepseek: 'first'});
    });

    it('保留仅有多 Key 的旧自定义服务，忽略无效和空白凭据行', () => {
        const migrated = normalizeConfig({apiKeys: {custom: [42, ' ', 'custom-key', 'backup-key']}});
        expect(migrated.customOpenAIProviders.some(provider => provider.id === 'custom')).toBe(true);
        expect(migrated.apiKeys.custom).toEqual(['', 'custom-key', 'backup-key']);
        expect(migrated.token.custom).toBe('custom-key');
        expect(normalizeConfig({apiKeys: {custom: [42, ' ']}}).customOpenAIProviders).toEqual([]);
    });
});

type KeySource = {apiKeys: Record<string, unknown>; token: Record<string, unknown>};

// 身份 computed 必须由 effect 消费，不能靠每次断言直接调用函数掩盖失效的订阅。
function observeKeys(source: KeySource, service = 'deepseek') {
    const calls = {rows: 0, keys: 0, revision: 0};
    const rows = computed(() => {calls.rows++;return getServiceApiKeyRows(source, service);});
    const keys = computed(() => {calls.keys++;return getServiceApiKeys(source, service);});
    const revision = computed(() => {calls.revision++;return createApiKeyCheckRevision(source, service);});
    const view = computed(() => ({rows: rows.value, keys: keys.value, revision: revision.value}));
    let observed!: typeof view.value;
    const runner = effect(() => {observed = view.value;});
    return {view, calls, get value() {return observed;}, dispose: () => stop(runner)};
}

function expectObserved(observation: ReturnType<typeof observeKeys>, rows: string[], keys: string[], service = 'deepseek') {
    // 独立的新普通对象提供 oracle；生产函数计算真实摘要，测试不复制 hash/身份实现。
    const expected = {apiKeys: {[service]: rows}};
    expect(observation.value).toEqual({rows, keys, revision: createApiKeyCheckRevision(expected, service)});
}

describe('API Key 首次添加的真实 Vue 响应式身份', () => {
    it.each(['apiKeys', 'token'] as const)('%s 从缺失到首次添加、替换和删除均更新已消费的身份', field => {
        const source = reactive<KeySource>({apiKeys: {}, token: {}});
        const observation = observeKeys(source);
        try {
            expectObserved(observation, [], []);
            const missing = observation.value;
            source[field].deepseek = field === 'apiKeys' ? [' first,key ', '', 'first,key'] : ' first,key ';
            expectObserved(observation, field === 'apiKeys' ? ['first,key', '', 'first,key'] : ['first,key'], ['first,key']);
            expect(observation.value.revision).not.toBe(missing.revision);
            const first = observation.value;
            source[field].deepseek = field === 'apiKeys' ? ['second-key'] : 'second-key';
            expectObserved(observation, ['second-key'], ['second-key']);
            expect(observation.value.revision).not.toBe(first.revision);
            delete source[field].deepseek;
            expectObserved(observation, [], []);
            expect(observation.value.revision).toBe(missing.revision);
            // 换成另一个空 map 后仍需订阅它的首次服务添加。
            source[field] = {};
            source[field].deepseek = field === 'apiKeys' ? ['third-key'] : 'third-key';
            expectObserved(observation, ['third-key'], ['third-key']);
        } finally {observation.dispose();}
    });

    it('首次新列表覆盖 legacy，空列表和空行不回退；删除或无效列表才读取当前 token', () => {
        const source = reactive<KeySource>({apiKeys: {}, token: {deepseek: ' legacy,key '}});
        const observation = observeKeys(source);
        try {
            expectObserved(observation, ['legacy,key'], ['legacy,key']);
            source.apiKeys.deepseek = [' ', ' new,key ', 'new,key'];
            expectObserved(observation, ['', 'new,key', 'new,key'], ['new,key']);
            const calls = {...observation.calls};
            source.token.deepseek = 'updated-legacy';
            expectObserved(observation, ['', 'new,key', 'new,key'], ['new,key']);
            expect(observation.calls).toEqual(calls);
            expect(normalizeConfig(source).token).toEqual({deepseek: 'new,key'});
            source.apiKeys.deepseek = [];
            expectObserved(observation, [], []);
            expect(normalizeConfig(source).token).toEqual({});
            source.apiKeys.deepseek = [' '];
            expectObserved(observation, [''], []);
            expect(apiKeysToToken(source.apiKeys)).toEqual({});
            delete source.apiKeys.deepseek;
            expectObserved(observation, ['updated-legacy'], ['updated-legacy']);
            source.apiKeys.deepseek = 'not-an-array';
            expectObserved(observation, ['updated-legacy'], ['updated-legacy']);
            source.token.deepseek = 'next-legacy';
            expectObserved(observation, ['next-legacy'], ['next-legacy']);
            source.apiKeys.deepseek = ['canonical-key'];
            expectObserved(observation, ['canonical-key'], ['canonical-key']);
        } finally {observation.dispose();}
    });

    it('apiKeys 与 token 的继承服务 getter 均不读取，也不进入已消费的身份', () => {
        let reads = 0;
        const inherited = () => Object.create(Object.defineProperty({}, 'deepseek', {
            get() {reads++;throw new Error('不得读取继承凭据');},
        })) as Record<string, unknown>;
        const source = reactive<KeySource>({apiKeys: inherited(), token: inherited()});
        const observation = observeKeys(source);
        try {
            expectObserved(observation, [], []);
            source.apiKeys = {deepseek: [' own,key ', '']};
            expectObserved(observation, ['own,key', ''], ['own,key']);
            source.apiKeys = inherited();
            expectObserved(observation, [], []);
            expect(reads).toBe(0);
        } finally {observation.dispose();}
    });

    it.each(['ordinary', 'null-prototype'])('%s map 的原型同名自有服务仍可读取、替换及删除', layout => {
        for (const service of ['__proto__', 'constructor', 'toString']) {
            const map = (value: unknown) => {
                const result = Object.fromEntries([[service, value]]);
                if (layout === 'null-prototype') Object.setPrototypeOf(result, null);
                return result;
            };
            const source = reactive<KeySource>({apiKeys: map(['']), token: map('legacy-key')});
            const observation = observeKeys(source, service);
            try {
                expectObserved(observation, [''], [], service);
                source.apiKeys[service] = [' own,key ', ''];
                expectObserved(observation, ['own,key', ''], ['own,key'], service);
                delete source.apiKeys[service];
                expectObserved(observation, ['legacy-key'], ['legacy-key'], service);
                source.token[service] = 'replacement-key';
                expectObserved(observation, ['replacement-key'], ['replacement-key'], service);
                delete source.token[service];
                expectObserved(observation, [], [], service);
                expect(Object.getPrototypeOf(source.apiKeys)).toBe(layout === 'ordinary' ? Object.prototype : null);
                expect(Object.getPrototypeOf(source.token)).toBe(layout === 'ordinary' ? Object.prototype : null);
            } finally {observation.dispose();}
        }
    });

    it.each([false, true])('本服务已配置=%s 时其它服务新增、替换和删除不重算本服务 computed', configured => {
        const source = reactive<KeySource>({apiKeys: configured ? {deepseek: ['selected-key']} : {}, token: {}});
        const observation = observeKeys(source);
        try {
            const rows = configured ? ['selected-key'] : [];
            expectObserved(observation, rows, rows);
            const original = observation.value, calls = {...observation.calls};
            const unchanged = () => {
                // 主动消费缓存也不能导致本服务的 getter 重新执行。
                expect(observation.view.value).toBe(original);
                expect(observation.value).toBe(original);
                expect(observation.calls).toEqual(calls);
            };
            source.apiKeys.openai = ['other-first'];unchanged();
            source.token.openai = 'other-legacy';unchanged();
            source.apiKeys.openai = ['other-second'];unchanged();
            source.token.openai = 'other-replacement';unchanged();
            delete source.apiKeys.openai;unchanged();
            delete source.token.openai;unchanged();
        } finally {observation.dispose();}
    });
});
