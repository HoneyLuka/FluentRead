/**
 * @file tests/featureMenuSettingsLifecycle.test.ts
 * 文件职责：验证实际功能服务分配和右键菜单设置的旧事件归属、值校验、预览与凭据读取范围。
 * 主要内容：执行真实缓存客户端模板，覆盖隐藏、缓存、配置替换、选项权限变化和多行功能模型；验证继承摘要、独立选择、凭据提示与三项菜单入口的前置条件。
 * 模块边界：Linkedom 保留实际节点树，展示控件与焦点为受控端口；不调用翻译或验证系统输入法。
 */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseHTML} from 'linkedom'
import vue from '@vitejs/plugin-vue'
import {createServer, type ViteDevServer} from 'vite'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import {createApiKeyRequirementKey} from '@/src/core/config/validation'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
let server: ViteDevServer, app: import('vue').App, document: Document, win: any, focused: Element | null
let state: Record<string, any>, props: Record<string, any>, shown: import('vue').Ref<boolean>
let events: Map<Element, Record<string, any>>
const updates = vi.fn(), focus = vi.fn(), selectionRange = vi.fn()
const featurePath = 'src/features/settings/ui/FeatureServiceSettings.vue', menuPath = 'src/features/settings/ui/ContextMenuSettings.vue'
async function settle() {await runtime.nextTick();await Promise.resolve();await runtime.nextTick()}
beforeEach(async () => {
  vi.clearAllMocks();events = new Map();const parsed = parseHTML('<html><body><div id="app"></div></body></html>');win = parsed.window;document = win.document;focused = document.body
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused})
  for (const [key, value] of Object.entries({document, window: win, HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLElement: win.HTMLElement, Event: win.Event, Node: win.Node})) vi.stubGlobal(key, value)
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent', resolve: {alias: {'@': process.cwd()}}, server: {hmr: false, middlewareMode: true},
    ssr: {noExternal: ['element-plus', '@element-plus/icons-vue']}, plugins: [{name: 'prompt-profile-controlled-ports', enforce: 'pre', resolveId(id) {
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0prompt-i18n'
      if (id === 'element-plus') return '\0prompt-element'
      if (id === '@element-plus/icons-vue') return '\0prompt-icons'
      if (id.endsWith('.vue') && !/\/(?:FeatureServiceSettings|ContextMenuSettings|SettingsDisclosure)\.vue$/u.test(id)) return '\0prompt-display'
      return null
    }, load(id) {
      if (id === '\0prompt-i18n') return "import {ref} from 'vue';export const useUiI18n = () => ({language: ref('zh-CN'), t: key => key, translateLegacy: text => text})"
      if (id === '\0prompt-element') return "import {h, getCurrentInstance} from 'vue';export const ElPopover = {setup(_, {attrs, slots}) {const instance = getCurrentInstance();return () => h('div', {...attrs, 'data-timing-port-key': instance.vnode.key}, [slots.reference?.(), slots.default?.()])}}"
      if (id === '\0prompt-icons') return 'export const ArrowDown = {}, WarningFilled = {}'
      if (id === '\0prompt-display') return "import {h} from 'vue';export default {setup(_, {slots}) {return () => h('div', null, [slots.copy?.(), slots.default?.()])}}"
      return null
    }}, vue()]})
})
afterEach(async () => {app?.unmount();await settle();await server?.close();vi.unstubAllGlobals()})
async function compile(path: string) {
  const filename = resolve(path), {descriptor} = parse(readFileSync(filename, 'utf8'), {filename})
  const bindings = compileScript(descriptor, {id: 'prompt-profile-test'}).bindings
  const template = compileTemplate({source: descriptor.template!.content, filename, id: 'prompt-profile-test', compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: bindings, expressionPlugins: ['typescript']}})
  expect(template.errors).toEqual([])
  const component = (await server.ssrLoadModule(`/${path}`)).default;component.ssrRender = undefined
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime)
  return component
}
async function mount(path: string, values: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  if (path === featurePath) await compile('src/features/settings/ui/components/SettingsDisclosure.vue')
  const component = await compile(path), source = runtime.shallowReactive({active: true, context: {}, contextKey: 'service-a', ...values});shown = runtime.ref(true)
  const renderer = runtime.createRenderer({patchProp(el: any, key: string, previous: any, next: any) {
    const handlers = events.get(el) || {};events.set(el, handlers)
    if (/^on[A-Z]/u.test(key)) {handlers[key] = next;const event = key.slice(2).toLowerCase();if (previous) el.removeEventListener(event, previous);if (next) el.addEventListener(event, next);return}
    if (key === 'value' || key === 'modelValue' || key === 'model-value') {el.value = next ?? '';el.setAttribute('data-model-value', String(next ?? ''));return}
    if (key === 'class') {el.className = next ?? '';return}
    if (next === false || next === undefined || next === null) el.removeAttribute(key);else el.setAttribute(key, String(next))
  }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor), remove: (child: any) => child.parentNode?.removeChild(child),
    createElement: tag => {const el = document.createElement(tag) as any;el.focus = (options: unknown) => {focus(options);focused = el}
      if (tag === 'textarea') {el.selectionStart = 0;el.selectionEnd = 0;el.setSelectionRange = (start: number, end: number) => {selectionRange(start, end);el.selectionStart = start;el.selectionEnd = end}}
      return el}, createText: text => document.createTextNode(text), createComment: text => document.createComment(text), setText: (n: any, text: string) => {n.nodeValue = text},
    setElementText: (el: any, text: string) => {el.textContent = text}, parentNode: (n: any) => n.parentNode, nextSibling: (n: any) => n.nextSibling,
    querySelector: selector => document.querySelector(selector), setScopeId: () => {}, cloneNode: (n: any) => n.cloneNode(true),
    insertStaticContent: (html: string, parent: any, anchor: any) => {const t = document.createElement('template');t.innerHTML = html;const first = t.content.firstChild!, last = t.content.lastChild!;parent.insertBefore(t.content, anchor);return [first, last]}})
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(component, {...source, ...listeners, ref: (vm: any) => {if (vm) {state = vm.$.setupState;props = vm.$.props}}}) : runtime.h({render: () => null}, {key: 'other'})})})
  const control = {setup(_props: unknown, {attrs}: any) {return () => runtime.h('input', attrs)}}
  app.component('el-switch', control);app.component('el-select', control);app.component('el-option', {render: () => null})
  app.component('el-icon', {render: () => null})
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => {};app.mount(document.getElementById('app')!);await settle()
}

const services = [{value: 'openai', label: 'OpenAI'}, {value: 'microsoft', label: 'Microsoft'}, {value: 'deepseek', label: 'DeepSeek'}, {value: 'gone', label: 'Gone', disabled: true}]
function eventOf(el: Element, name = 'onUpdate:modelValue') {const fn = events.get(el)?.[name];expect(fn, name).toBeTypeOf('function');return fn}
function featureControl(id: string) {return document.querySelector(`[data-feature-service="${id}"] input`)!}
function menuControl(id: string) {return document.querySelector(`[data-context-menu-entry="${id}"] input`)!}
function master() {return document.querySelector('input')!}
function invalidate(reason: string) {if (reason === 'hidden') props.active = false;if (reason === 'cached') shown.value = false;if (reason === 'unmount') app.unmount();if (reason === 'config') props.config = runtime.reactive(new Config())}
function snapshot(config: Config) {return {service: config.service, hover: config.hoverTranslationService, selection: config.selectionTranslationService, master: config.contextMenuEnabled, entries: {...config.contextMenuEntries}}}
async function mountFeature(config = runtime.reactive(new Config()), values: Record<string, unknown> = {}) {await mount(featurePath, {config, serviceOptions: services, ...values}, {'onConfigure-service': updates})}
async function mountMenu(config: Config = runtime.reactive(Object.assign(new Config(), {disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual'})), values: Record<string, unknown> = {}) {await mount(menuPath, {config, ...values})}

describe('功能服务分配实际缓存模板归属', () => {
  it('默认折叠显示继承摘要，独立服务的缺配置状态仍可发现且不改变配置', async () => {
    const config = runtime.reactive(new Config()); config.service = 'microsoft'; await mountFeature(config)
    expect(document.querySelector('details.feature-services')?.hasAttribute('open')).toBe(false)
    expect(state.summaryServices).toBe('featureServices.followDefault')
    expect(state.summaryWarning).toBe('')
    config.selectionTranslationService = 'openai'; await settle()
    const snapshot = JSON.stringify(config)
    expect(state.summaryServices).toBe('featureServices.selection')
    expect(state.summaryWarning).toContain('API Key')
    expect(document.querySelector('.feature-services-status')?.textContent).toBe('featureServices.needsSetup')
    expect(JSON.stringify(config)).toBe(snapshot)
    config.token.openai = 'fixture'; await settle()
    expect(state.summaryWarning).toBe('')
    expect(document.querySelector('.feature-services-status')?.textContent).toBe('featureServices.selection')
    expect(config.selectionTranslationService).toBe('openai')
    expect(updates).not.toHaveBeenCalled()
  })
  it('旧套餐默认继承使用目录名称，不重新开放选项且父级标签优先', async () => {
    const config = runtime.reactive(new Config());config.service = 'chatgptPlan';config.model.chatgptPlan = 'saved-account-model';await mountFeature(config)
    const before = JSON.stringify(config)
    expect(state.serviceLabel(config.service)).toBe('ChatGPT 套餐')
    expect(featureControl('hover').getAttribute('data-model-value')).toBe('')
    expect(state.rows.find((row: any) => row.feature.id === 'hover').choices.some((item: any) => item.value === 'chatgptPlan')).toBe(false)
    eventOf(featureControl('hover'))('chatgptPlan');expect(config.hoverTranslationService).toBe('');expect(JSON.stringify(config)).toBe(before)
    props.serviceOptions = services.map(item => item.value === 'openai' ? {...item, label: '父级自定义显示名称'} : item);await settle()
    expect(state.serviceLabel('openai')).toBe('父级自定义显示名称');expect(state.serviceLabel('unknown-saved-service')).toBe('unknown-saved-service')
    expect(JSON.stringify(config)).toBe(before);expect(updates).not.toHaveBeenCalled()
  })
  it.each(['hidden', 'cached', 'unmount', 'config'])('%s 后旧选择和配置连接事件失效', async reason => {
    await mountFeature();const choose = eventOf(featureControl('selection')), connect = eventOf(document.querySelector('[data-feature-service="selection"] button')!, 'onClick');invalidate(reason);await settle();const before = snapshot(props.config)
    choose('openai');connect();expect(snapshot(props.config)).toEqual(before);expect(updates).not.toHaveBeenCalled()
  })
  it('拒绝未知/停用的服务和非字符串值，普通功能可以选择机器翻译并跟随默认', async () => {
    await mountFeature();const before = snapshot(props.config)
    eventOf(featureControl('hover'))('gone');eventOf(featureControl('hover'))('missing');eventOf(featureControl('hover'))(true);expect(snapshot(props.config)).toEqual(before)
    eventOf(featureControl('hover'))('microsoft');expect(props.config.hoverTranslationService).toBe('microsoft');await settle();eventOf(featureControl('hover'))('');expect(props.config.hoverTranslationService).toBe('')
  })
  it('旧选择在目录权限变化后不能写入，停用的已选项继续展示并允许恢复继承', async () => {
    const config = runtime.reactive(new Config());config.hoverTranslationService = 'gone';await mountFeature(config)
    const old = eventOf(featureControl('hover'));props.serviceOptions = [{value: 'openai', label: 'OpenAI', disabled: true}];await settle();old('openai');expect(config.hoverTranslationService).toBe('gone')
    expect(featureControl('hover').getAttribute('data-model-value')).toBe('gone');eventOf(featureControl('hover'))('');expect(config.hoverTranslationService).toBe('')
  })
  it('配置连接定位捕获当前有效服务，不因外部默认或分配变化跳到另一项', async () => {
    const config = runtime.reactive(new Config());config.service = 'openai';await mountFeature(config);const old = eventOf(document.querySelector('[data-feature-service="hover"] button')!, 'onClick')
    config.hoverTranslationService = 'microsoft';await settle();old();expect(updates).not.toHaveBeenCalled();eventOf(document.querySelector('[data-feature-service="hover"] button')!, 'onClick')();expect(updates).toHaveBeenCalledWith('microsoft')
  })
  it('两行功能服务按有效模型独立计算凭据，每次渲染不枚举其他配置或模型', async () => {
    const config = runtime.reactive(new Config());config.service = 'openai';config.model.openai = 'main';config.requireApiKey[createApiKeyRequirementKey('openai','main')] = false;let fields = 0, models = 0
    for (let i = 0;i < 1000;i++) Object.defineProperty(config,`unrelated${i}`,{enumerable:true, configurable:true,get:()=>{fields++;return ''}})
    for (let i = 0;i < 500;i++) Object.defineProperty(config.model,`unrelated${i}`,{enumerable:true, configurable:true,get:()=>{models++;return ''}})
    await mountFeature(config)
    expect(document.querySelectorAll('[data-feature-service]').length).toBe(2)
    expect([...document.querySelectorAll('[data-feature-service]')].every(row => row.querySelector('.feature-service-warning') === null)).toBe(true)
    expect({fields,models}).toEqual({fields:0,models:0})
    config.requireApiKey[createApiKeyRequirementKey('openai','main')] = true;await settle()
    expect(document.querySelector('[data-feature-service="hover"] .feature-service-warning')).not.toBeNull()
    expect(document.querySelector('[data-feature-service="selection"] .feature-service-warning')).not.toBeNull()
  })
  it('未声明 active 的普通调用仍可分配服务并保存独立选择', async () => {
    const config = runtime.reactive(new Config());config.service = 'microsoft';await mountFeature(config,{active:undefined})
    eventOf(featureControl('hover'))('openai');expect(config.hoverTranslationService).toBe('openai')
    eventOf(featureControl('selection'))('deepseek');expect(config.selectionTranslationService).toBe('deepseek')
  })
})

describe('右键入口实际缓存模板与前置条件门禁', () => {
  it.each(['hidden', 'cached', 'unmount', 'config'])('%s 后旧总开关与入口事件失效', async reason => {
    await mountMenu();const change = eventOf(master()), page = eventOf(menuControl('translatePage'));invalidate(reason);await settle();const before = snapshot(props.config)
    change(false);page(false);expect(snapshot(props.config)).toEqual(before)
  })
  it('总开关关闭后旧入口事件不能改偏好，重新开启保留已保存的入口', async () => {
    await mountMenu();const change = eventOf(menuControl('translatePage'));eventOf(master())(false);await settle();change(false);expect(props.config.contextMenuEntries.translatePage).toBeUndefined();expect(document.querySelectorAll('[data-context-menu-action]').length).toBe(0)
    eventOf(master())(true);await settle();expect(document.querySelector('[data-context-menu-action="translatePage"]')).not.toBeNull()
  })
  it('translateSelection 的前置条件在事件发出前再校验', async () => {
    const config = runtime.reactive(new Config());config.disableSelectionTranslator = false;config.selectionTranslatorMode = 'bilingual';await mountMenu(config);const old = eventOf(menuControl('translateSelection'))
    config.disableSelectionTranslator = true;await settle();old(false)
    expect(config.contextMenuEntries.translateSelection).not.toBe(false);expect(menuControl('translateSelection').hasAttribute('disabled')).toBe(true)
  })
  it('未知 ID、非布尔值不写，恢复后预览完整', async () => {
    await mountMenu();eventOf(master())('false');eventOf(menuControl('translatePage'))('false');state.writeEntryPreference('unknown',true);expect(props.config.contextMenuEnabled).toBe(true);expect(props.config.contextMenuEntries).toEqual({})
    eventOf(menuControl('translatePage'))(false);await settle();expect(props.config.contextMenuEntries.translatePage).toBe(false);expect(document.querySelector('[data-context-menu-action="translatePage"]')).toBeNull()
    eventOf(menuControl('translatePage'))(true);await settle();expect(document.querySelectorAll('[data-context-menu-entry]').length).toBe(3);expect(document.querySelector('[data-context-menu-action="translatePage"]')).not.toBeNull()
  })
  it('translatePage 偏好被外部更新后，旧事件不能借用新控件', async () => {
    await mountMenu();const old = eventOf(menuControl('translatePage'));props.config.contextMenuEntries = {translatePage:false};await settle();old(true);expect(menuControl('translatePage').getAttribute('data-model-value')).toBe('false');eventOf(menuControl('translatePage'))(true);await settle();expect(menuControl('translatePage').getAttribute('data-model-value')).toBe('true')
  })
  it('入口名全部保留，普通默认调用允许开关且前置不可用时保留用户偏好', async () => {
    const config = runtime.reactive(Object.assign(new Config(), {disableSelectionTranslator: true, selectionTranslatorMode: 'disabled'}));await mountMenu(config,{active:undefined})
    eventOf(menuControl('toggleSite'))(true);await settle();expect(config.contextMenuEntries.toggleSite).toBe(true);expect(document.querySelector('[data-context-menu-action="toggleSite"]')).not.toBeNull()
    config.contextMenuEntries = {...config.contextMenuEntries, toggleSite: false};await settle();expect(document.querySelector('[data-context-menu-action="toggleSite"]')).toBeNull()
    expect(document.querySelector('[data-context-menu-entry="translateSelection"]')).not.toBeNull()
  })
})
