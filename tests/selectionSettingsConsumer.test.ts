/**
 * @file tests/selectionSettingsConsumer.test.ts
 * 文件职责：作为 SelectionSettings 的真实组件消费者，验证预览操作与父级配置草稿的联动。
 * 主要内容：执行目标 SFC/setup/template 及真实开关/布局子组件，通过 DOM click 验证词典来源、启用开关、冲突拒绝与静态预览；预览不改配置。
 * 模块边界：linkedom 提供 DOM；只隔离无关的共享设置行与选择器端口，不 mock 目标、复制产品事件或读取私有 setup；不证明浏览器可信输入、像素、存储或供应商行为。
 */
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {dirname, resolve} from 'node:path';
import {compileVueInlineFixture} from './helpers/compiledVueFixture';

const dom = await vi.hoisted(async () => {
    const {parseHTML} = await import('linkedom');
    const {window, document} = parseHTML('<html><body></body></html>');
    const keys = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'ShadowRoot', 'Event'];
    const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const nodeTag = Object.getOwnPropertyDescriptor(window.Node.prototype, Symbol.toStringTag);
    Object.defineProperty(window.Node.prototype, Symbol.toStringTag, {configurable: true, get() {return this.constructor.name;}});
    for (const key of keys) Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: (window as any)[key]});
    return {document: document as unknown as Document, Event: window.Event, restore() {
        for (const [key, original] of originals) {
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        }
        if (nodeTag) Object.defineProperty(window.Node.prototype, Symbol.toStringTag, nodeTag);
        else Reflect.deleteProperty(window.Node.prototype, Symbol.toStringTag);
    }};
});

import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as clickSelection from '@/src/core/config/clickSelection';
import * as selectionDictionary from '@/src/core/config/selectionDictionary';
const warning = vi.fn();
const browserCapabilities = {browser: 'chrome'};

// 共享设置行与选择器只提供公开插槽/更新端口；生产浏览器专项验证实际 Element Plus 菜单与持久化。
const SettingsItemPort = Vue.defineComponent({props: ['label', 'help'], setup: (props, {slots}) =>
    () => Vue.h('label', [Vue.h('span', props.label), slots.default?.()])});
const SelectPort = Vue.defineComponent({props: ['modelValue', 'filterable'], emits: ['update:modelValue'], setup: (props, {slots, emit}) =>
    () => Vue.h('select', {'data-model-value': props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value)}, slots.default?.())});
const OptionPort = Vue.defineComponent({props: ['value', 'label', 'disabled'], setup: props => () => Vue.h('option', {value: props.value, disabled: props.disabled ? '' : undefined}, props.label)});
const actualComponents = new Set([
    'src/features/settings/ui/SelectionSettings.vue',
    'src/ui/components/FeatureEnableCard.vue',
    'src/features/settings/ui/components/SettingsGroup.vue',
    'src/features/settings/ui/components/SettingsPreviewLayout.vue',
].map(relative => resolve(process.cwd(), relative)));
function loadClient(relative: string, components = new Map<string, Vue.Component>()): Vue.Component {
    const filename = resolve(process.cwd(), relative);
    if (components.has(filename)) return components.get(filename)!;
    if (!actualComponents.has(filename)) throw new Error(`Unexpected Selection settings component: ${relative}`);
    const compiled = compileVueInlineFixture(filename, {id: filename});
    expect(compiled.parseErrors).toEqual([]);
    const dependencies: Record<string, unknown> = {
        vue: Vue,
        '@/src/ui/i18n': {useUiI18n: () => ({t: (key: string, params?: Record<string, unknown>) => params ? key + ' ' + JSON.stringify(params) : key, translateLegacy: (value: string) => value})},
        '@/src/core/config/clickSelection': clickSelection,
        '@/src/core/config/selectionDictionary': selectionDictionary,
        '@/src/platform/browser/capabilities': {browserCapabilities},
        'element-plus': {ElMessage: {warning}, ElOption: OptionPort},
        '@/src/ui/components/UiSelect.vue': {default: SelectPort},
        './components/SettingsItem.vue': {default: SettingsItemPort},
        './settings-card-heading.css': {},
    };
    const module = {exports: {} as {default: Vue.Component}};
    new Function('require', 'exports', 'module', compiled.code)((id: string) => {
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        if (id.endsWith('.vue')) return {default: loadClient(id.startsWith('@/') ? id.slice(2) : resolve(dirname(filename), id), components)};
        throw new Error(`Unexpected Selection settings dependency: ${id}`);
    }, module.exports, module);
    components.set(filename, module.exports.default);
    return module.exports.default;
}

let app: Vue.App | undefined, root: HTMLElement, state: {config: Config};
async function settle(): Promise<void> {await Vue.nextTick(); await Vue.nextTick();}
async function mount(config = new Config()): Promise<void> {
    root = dom.document.createElement('div');dom.document.body.append(root);
    state = Vue.reactive({config});
    const component = loadClient('src/features/settings/ui/SelectionSettings.vue');
    app = Vue.createApp({setup: () => () => Vue.h(component, {config: state.config})});
    app.mount(root);await settle();
}
afterEach(async () => {warning.mockClear();browserCapabilities.browser = 'chrome';app?.unmount();app = undefined;await settle();dom.document.body.replaceChildren();});
afterAll(() => dom.restore());
function control<T extends Element = HTMLButtonElement>(selector: string): T {
    const node = root.querySelector<T>(selector);
    expect(node, `Rendered Selection settings control ${selector}`).not.toBeNull();
    return node!;
}
async function click(node: Element): Promise<void> {
    // 普通 DOM 事件进入实际编译模板；不直接调用 handler，也不伪造 isTrusted。
    const event = new dom.Event('click', {bubbles: true});
    Object.assign(event, {_vts: Date.now() + 1});node.dispatchEvent(event);await settle();
}
function snapshot(config: Config): Record<string, unknown> {return JSON.parse(JSON.stringify(config));}
function withoutSelectionSwitch(config: Config): Record<string, unknown> {
    const value = snapshot(config);delete value.selectionTranslatorMode;delete value.disableSelectionTranslator;return value;
}
const switchSelector = '.feature-enable-card button[role="switch"][aria-label="启用划词翻译"]';

describe('SelectionSettings 真实模板消费者', () => {
    it('默认自动来源可切换全部词典，关闭重开和父级配置替换保留选择', async () => {
        await mount();
        const source = () => control<HTMLSelectElement>('[data-testid="selection-dictionary-source"]');
        expect(source().getAttribute('aria-label')).toBe('selection.dictionary.source');
        expect(state.config.selectionDictionarySource).toBe('auto');
        expect([...source().querySelectorAll('option')].map(option => option.getAttribute('value')))
            .toEqual(selectionDictionary.WORD_DICTIONARY_SOURCE_OPTIONS.map(option => option.value));
        const before = snapshot(state.config);
        for (const {value} of selectionDictionary.WORD_DICTIONARY_SOURCE_OPTIONS) {
            const option = source().querySelector<HTMLOptionElement>(`option[value="${value}"]`)!;
            for (const item of source().querySelectorAll('option')) item.removeAttribute('selected');
            option.setAttribute('selected', '');
            source().dispatchEvent(new dom.Event('change', {bubbles: true}));await settle();
            expect(state.config.selectionDictionarySource).toBe(value);
        }
        await click(control(switchSelector));await click(control(switchSelector));
        expect(state.config.selectionDictionarySource).toBe('datamuse');
        state.config = Object.assign(new Config(), {selectionDictionarySource: 'free-dictionary' as const});await settle();
        expect(state.config.selectionDictionarySource).toBe('free-dictionary');
        expect(source().getAttribute('data-model-value')).toBe('free-dictionary');
        const withoutSource = snapshot(state.config);delete withoutSource.selectionDictionarySource;
        const original = {...before};delete original.selectionDictionarySource;
        expect(withoutSource).toEqual(original);
    });

    it('点选组合被局部翻译占用时拒绝启用，释放后恢复', async () => {
        const config = Object.assign(new Config(), {
            selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, selectionClickSelectEnabled: true,
            selectionClickSelectHotkey: 'Alt+R', sectionTranslationHotkeyEnabled: true, sectionTranslationHotkey: 'Alt+R',
        });
        await mount(config);await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('disabled');
        expect(state.config.disableSelectionTranslator).toBe(true);
        expect(warning).toHaveBeenCalled();
        state.config.sectionTranslationHotkeyEnabled = false;await settle();await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('bilingual');expect(state.config.disableSelectionTranslator).toBe(false);
    });

    it('停用期间产生冲突保留原显示模式；关闭点选偏好后允许恢复', async () => {
        await mount(Object.assign(new Config(),{selectionTranslatorMode:'translation-only',disableSelectionTranslator:false,selectionClickSelectEnabled:true}));
        await click(control(switchSelector));state.config.hotkey='custom';state.config.customHotkey='Alt+Shift+S';await settle();
        await click(control(switchSelector));expect(state.config.selectionTranslatorMode).toBe('disabled');expect(warning).toHaveBeenCalled();
        state.config.selectionClickSelectEnabled=false;await click(control(switchSelector));expect(state.config.selectionTranslatorMode).toBe('translation-only');
    });

    it('静态预览展示单词卡片内容，交互开关不修改配置', async () => {
        await mount();const before = snapshot(state.config);
        expect(control('.selection-preview-source').textContent).toBe('curious');
        expect(control('.selection-preview-translation').textContent).toBe('好奇的；求知欲强的');
        expect(control('.selection-preview-word').textContent).toContain('Eager to know or learn something.');
        expect(snapshot(state.config)).toEqual(before);
    });

    it.each(['bilingual', 'translation-only'])('%s 通过真实 FeatureEnableCard 关闭再开启，恢复显示模式并同步兼容字段', async mode => {
        const config = new Config();config.selectionTranslatorMode = mode;config.disableSelectionTranslator = false;
        await mount(config);const untouched = withoutSelectionSwitch(state.config);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('disabled');
        expect(state.config.disableSelectionTranslator).toBe(true);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('false');
        expect(withoutSelectionSwitch(state.config)).toEqual(untouched);
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe(mode);
        expect(state.config.disableSelectionTranslator).toBe(false);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        expect(withoutSelectionSwitch(state.config)).toEqual(untouched);
    });

    it('默认关闭可正常开启；父级当前草稿变化更新开关', async () => {
        await mount();expect(control(switchSelector).getAttribute('aria-checked')).toBe('false');
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('bilingual');expect(state.config.disableSelectionTranslator).toBe(false);
        state.config.selectionTranslatorMode = 'translation-only';state.config.disableSelectionTranslator = false;await settle();
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        await click(control(switchSelector));await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('translation-only');expect(state.config.disableSelectionTranslator).toBe(false);
    });
});
