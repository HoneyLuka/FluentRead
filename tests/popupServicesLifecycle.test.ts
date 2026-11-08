/**
 * @file tests/popupServicesLifecycle.test.ts
 * 文件职责：验证实际 Popup 服务选择模板的事件归属、面板焦点、独立模型与凭据读取范围。
 * 主要内容：执行真实缓存客户端模板，覆盖隐藏、缓存、配置替换、选择会话切换、查询、目录权限、九种功能模型和默认继承；验证B站免费阅读选项、固定模型与写作拒绝边界；通过实际抽屉祖先与受控 DOM 几何验证进入/返回的局部滚动及同步、迟到、焦点保护。
 * 模块边界：Linkedom 保留实际节点树，展示控件与焦点为受控端口；不调用翻译或验证系统输入法。
 */
import * as runtime from 'vue'
import {parseHTML} from 'linkedom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'

let app: import('vue').App, document: Document, win: any, focused: Element | null
let state: Record<string, any>, props: Record<string, any>, shown: import('vue').Ref<boolean>
let events: Map<Element, Record<string, any>>
let scrollPort: HTMLElement | undefined
const scrollWrites: number[] = []
const updates = vi.fn(), focus = vi.fn(), selectionRange = vi.fn()
let capabilities: Record<string, unknown>
async function settle() {await runtime.nextTick();await Promise.resolve();await runtime.nextTick()}
beforeEach(async () => {
  vi.clearAllMocks();scrollPort=undefined;scrollWrites.length=0;capabilities = runtime.reactive({browser: 'chrome'});events = new Map();const parsed = parseHTML('<html><body><div id="app"></div></body></html>');win = parsed.window;document = win.document;focused = document.body
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused})
  for (const [key, value] of Object.entries({document, window: win, HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLElement: win.HTMLElement, Event: win.Event, Node: win.Node})) vi.stubGlobal(key, value)
  vi.resetModules()
  vi.doMock('@/src/ui/i18n', () => ({useUiI18n: () => ({language: runtime.ref('zh-CN'), t: (key: string, params?: {model?: string}) => params?.model ? `${key} ${params.model}` : key, translateLegacy: (text: string) => text})}))
  vi.doMock('@/src/platform/browser/capabilities', () => ({browserCapabilities: capabilities}))
  vi.doMock('@/src/ui/components/ServiceIcon.vue', () => ({default: {setup(_: unknown, {slots}: any) {return () => runtime.h('div', null, [slots.copy?.(), slots.default?.()])}}}))
})
afterEach(async () => {app?.unmount();await settle();vi.unstubAllGlobals()})
async function mount(values: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  const component = (await import('@/src/app/popup/PopupServices.vue')).default
  const source = runtime.shallowReactive({active: true, context: {}, contextKey: 'service-a', ...values});shown = runtime.ref(true)
  const renderer = runtime.createRenderer({patchProp(el: any, key: string, previous: any, next: any) {
    const handlers = events.get(el) || {};events.set(el, handlers)
    if (/^on[A-Z]/u.test(key)) {handlers[key] = next;const event = key.slice(2).toLowerCase();if (previous) el.removeEventListener(event, previous);if (next) el.addEventListener(event, next);return}
    if (key === 'value' || key === 'modelValue' || key === 'model-value') {el.value = next ?? '';el.setAttribute('data-model-value', String(next ?? ''));return}
    if (key === 'class') {el.className = next ?? '';return}
    if (next === false || next === undefined || next === null) el.removeAttribute(key);else el.setAttribute(key, String(next))
  }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor), remove: (child: any) => child.parentNode?.removeChild(child),
    createElement: tag => {const el = document.createElement(tag) as any;el.focus = (options: unknown) => {focus(options);focused = el};el.getBoundingClientRect=()=>geometry(el)
      if (tag === 'textarea') {el.selectionStart = 0;el.selectionEnd = 0;el.setSelectionRange = (start: number, end: number) => {selectionRange(start, end);el.selectionStart = start;el.selectionEnd = end}}
      return el}, createText: text => document.createTextNode(text), createComment: text => document.createComment(text), setText: (n: any, text: string) => {n.nodeValue = text},
    setElementText: (el: any, text: string) => {el.textContent = text}, parentNode: (n: any) => n.parentNode, nextSibling: (n: any) => n.nextSibling,
    querySelector: selector => document.querySelector(selector), setScopeId: () => {}, cloneNode: (n: any) => n.cloneNode(true),
    insertStaticContent: (html: string, parent: any, anchor: any) => {const t = document.createElement('template');t.innerHTML = html;const first = t.content.firstChild!, last = t.content.lastChild!;parent.insertBefore(t.content, anchor);return [first, last]}})
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(component as runtime.Component, {...source, ...listeners, ref: (vm: any) => {if (vm) {state = vm.$.setupState;props = vm.$.props}}}) : runtime.h({render: () => null}, {key: 'other'})})})
  const control = {setup(_props: unknown, {attrs}: any) {return () => runtime.h('input', attrs)}}
  app.component('el-switch', control);app.component('el-select', control);app.component('el-option', {render: () => null})
  app.component('el-icon', {render: () => null})
  app.config.warnHandler = () => {};app.mount(document.getElementById('app')!);await settle()
}


const services = [{value: 'openai', label: 'OpenAI'}, {value: 'microsoft', label: 'Microsoft'}, {value: 'deepseek', label: 'DeepSeek'}, {value: 'gone', label: 'Gone', disabled: true}]
function eventOf(el: Element, name = 'onClick') {const fn = events.get(el)?.[name];expect(fn, name).toBeTypeOf('function');return fn}
function row(id: string) {return document.querySelector(`[data-feature-service="${id}"]`)!}
function option(id: string) {return document.querySelector(`[data-service-choice="${id}"]`)!}
function invalidate(reason: string) {if (reason === 'hidden') props.active = false;if (reason === 'cached') shown.value = false;if (reason === 'unmount') app.unmount();if (reason === 'config') props.config = runtime.reactive(new Config())}
function snapshot(config: Config) {return {service: config.service, hover: config.hoverTranslationService, selection: config.selectionTranslationService}}
// 待配置的服务收在折叠的更多区；夹具默认填好凭据，让 OpenAI 与 DeepSeek 留在常用区供事件归属用例直接点击。
async function mountPopup(config = runtime.reactive(new Config()), values: Record<string, unknown> = {}, credentials = true) {config.service = 'openai';if (credentials) for (const id of ['openai', 'deepseek']) config.token[id] ||= 'test-only-key';await mount({config, serviceOptions: services, ...values}, {onClose: updates})}
async function open(id: string) {const el = row(id) as HTMLElement;el.focus();eventOf(el)();await settle();expect(document.querySelector('[data-service-picker]')?.getAttribute('data-service-picker')).toBe(id)}
async function search(keyword: string) {const input = document.querySelector('input[type="search"]') as HTMLInputElement;input.value = keyword;eventOf(input, 'onInput')({target: input});await settle()}
function pickerBack() {return eventOf(document.querySelector('.service-picker-back')!)}
function rect(top: number, height: number) {return {top,bottom:top+height,left:0,right:280,width:280,height,x:0,y:top,toJSON:()=>({top,height})} as DOMRect}
function geometry(el: Element): DOMRect {
  if(el===scrollPort)return rect(100,206)
  if(el.matches('.popup-service-toolbar'))return rect(100,46)
  const id=el.getAttribute('data-feature-service')
  if(id){const index=[...document.querySelectorAll('[data-feature-service]')].indexOf(el);return rect(154+index*64-(scrollPort?.scrollTop||0),48)}
  return rect(170-(scrollPort?.scrollTop||0),46)
}
function attachOwnedScroller() {
  const drawer=document.createElement('div');drawer.className='popup-services-drawer'
  const body=document.createElement('div');body.className='el-drawer__body';drawer.append(body);document.body.append(drawer);body.append(document.getElementById('app')!)
  let top=0;Object.defineProperties(body,{clientTop:{value:0},clientHeight:{value:206},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,value);scrollWrites.push(top)}}})
  body.getBoundingClientRect=()=>rect(100,206);scrollPort=body;document.body.scrollTop=79
  return body
}
function expectTargetVisible(el: Element) {const box=geometry(el);expect(box.top).toBeGreaterThanOrEqual(146);expect(box.bottom).toBeLessThanOrEqual(306);expect(document.body.scrollTop).toBe(79)}


describe('Popup 服务选择实际缓存模板', () => {
  it('关闭的服务不能在功能面板重新选用，原独立选择保留并可在启用后恢复', async () => {
    const config = runtime.reactive(new Config()); config.disabledTranslationServices = ['deepseek']; config.hoverTranslationService = 'deepseek';
    await mountPopup(config); const before = JSON.stringify(config); await open('default'); await search('deepseek');
    expect(option('deepseek')).toBeNull(); expect(JSON.stringify(config)).toBe(before);
    pickerBack()(); await settle();
    expect(row('hover')?.querySelector('.assignment-warning')?.getAttribute('aria-label')).toBe('settings.services.library.serviceDisabledMessage');
    await open('hover'); expect(option('deepseek').hasAttribute('disabled')).toBe(true);
    const stale = eventOf(option('deepseek')); stale(); await settle(); expect(JSON.stringify(config)).toBe(before);
    config.disabledTranslationServices = []; await settle();
    expect(option('deepseek').hasAttribute('disabled')).toBe(false);
  })
  it('实际选择视图同步清掉抽屉旧滚动，返回后默认行可见且不滚动宿主',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();scroller.scrollTop=840;const source=row('default') as HTMLElement;source.focus();eventOf(source)()
    expect(scroller.scrollTop).toBe(0);await settle();expectTargetVisible(document.querySelector('input')!);expect(focus).toHaveBeenLastCalledWith({preventScroll:true})
    scroller.scrollTop=1222;pickerBack()();expect(scroller.scrollTop).toBe(0);await settle()
    expectTargetVisible(row('default'));expect(focused).toBe(row('default'))
  })
  it('从底部功能返回时只在当前drawer内让源行避开sticky toolbar',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('selection');scroller.scrollTop=1222;pickerBack()();await settle()
    expect(scroller.scrollTop).toBeGreaterThan(0);expectTargetVisible(row('selection'));expect(focused).toBe(row('selection'))
  })
  it('用户在转场前已掌握外部焦点，同步和渲染后都不滚动或聚焦',async()=>{
    await mountPopup();const scroller=attachOwnedScroller(),outside=document.createElement('button');document.body.append(outside);focused=outside;scroller.scrollTop=340;scrollWrites.length=0;focus.mockClear()
    eventOf(row('selection'))();expect(scrollWrites).toEqual([]);await settle();expect(scroller.scrollTop).toBe(340);expect(scrollWrites).toEqual([]);expect(focus).not.toHaveBeenCalled()
    pickerBack()();expect(scrollWrites).toEqual([]);await settle();expect(scroller.scrollTop).toBe(340);expect(focused).toBe(outside)
  })
  it('用户在转场后主动移走焦点，nextTick不再调整滚动或抢焦点',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('selection');pickerBack()();scroller.scrollTop=77
    const outside=document.createElement('button');document.body.append(outside);focused=outside;scrollWrites.length=0;focus.mockClear();await settle()
    expect(scrollWrites).toEqual([]);expect(scroller.scrollTop).toBe(77);expect(focus).not.toHaveBeenCalled();expect(document.body.scrollTop).toBe(79)
  })
  it.each(['hidden','cached','unmount','config'])('同步转场后 %s，迟到渲染任务不再滚动旧容器',async reason=>{
    await mountPopup();const scroller=attachOwnedScroller();const source=row('selection') as HTMLElement;source.focus();eventOf(source)();expect(scroller.scrollTop).toBe(0)
    scroller.scrollTop=91;scrollWrites.length=0;invalidate(reason);await settle();expect(scrollWrites).toEqual([]);expect(scroller.scrollTop).toBe(91);expect(document.body.scrollTop).toBe(79)
  })
  it('返回后立即打开另一个会话，旧源行任务不能滚动新picker',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('selection');pickerBack()();state.openPicker(state.fields.find((field:any)=>field.id==='hover'))
    scrollWrites.length=0;await settle();expect(scroller.scrollTop).toBe(0);expect(scrollWrites).toEqual([]);expect(document.querySelector('[data-service-picker]')?.getAttribute('data-service-picker')).toBe('hover')
  })
  it('转场后当前面板被移到另一drawer，不对旧或新滚动容器误写',async()=>{
    await mountPopup();const old=attachOwnedScroller();await open('selection');pickerBack()();old.scrollTop=73;const other=document.createElement('div');other.className='el-drawer__body';old.parentElement!.append(other);other.append(document.getElementById('app')!)
    other.scrollTop=64;scrollWrites.length=0;await settle();expect(old.scrollTop).toBe(73);expect(other.scrollTop).toBe(64);expect(scrollWrites).toEqual([]);expect(document.body.scrollTop).toBe(79)
  })

  it.each([{label:'部分被标题遮住',top:40,expected:24},{label:'完整滚到标题上方',top:200,expected:24},{label:'已经完整可见',top:0,expected:0}])('视口恢复时搜索框$label，只调整当前抽屉并保留查询与焦点',async({top,expected})=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('default');await search('gpt')
    const input=document.querySelector('input[type="search"]') as HTMLInputElement,heading=document.querySelector('.service-picker-heading') as HTMLElement
    heading.getBoundingClientRect=()=>rect(100,46);scroller.scrollTop=top;scrollWrites.length=0;focus.mockClear()
    state.revealFocusedSearch(()=>true);await settle()
    expect(scroller.scrollTop).toBe(expected);expect(scrollWrites).toEqual(top===expected?[]:[expected])
    expect(document.querySelector('input[type="search"]')).toBe(input);expect(input.value).toBe('gpt');expect(focused).toBe(input)
    expectTargetVisible(input);expect(focus).not.toHaveBeenCalled()
  })
  it('视口恢复任务等待渲染时用户移走焦点，不滚动也不重新聚焦搜索框',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('default');await search('gpt')
    const heading=document.querySelector('.service-picker-heading') as HTMLElement;heading.getBoundingClientRect=()=>rect(100,46)
    scroller.scrollTop=200;scrollWrites.length=0;focus.mockClear();state.revealFocusedSearch(()=>true)
    const outside=document.createElement('button');document.body.append(outside);focused=outside;await settle()
    expect(scrollWrites).toEqual([]);expect(scroller.scrollTop).toBe(200);expect(focused).toBe(outside);expect(focus).not.toHaveBeenCalled();expect(document.body.scrollTop).toBe(79)
  })
  it('仍在短视口时不为搜索框重置用户查看服务列表的位置',async()=>{
    await mountPopup();const scroller=attachOwnedScroller();await open('default');await search('gpt')
    const modal=document.createElement('div');modal.className='popup-drawer-modal';modal.setAttribute('data-fluent-read-popup-short','');scroller.parentElement!.before(modal);modal.append(scroller.parentElement!)
    scroller.scrollTop=200;scrollWrites.length=0;focus.mockClear();state.revealFocusedSearch(()=>true);await settle()
    expect(scrollWrites).toEqual([]);expect(scroller.scrollTop).toBe(200);expect(focused).toBe(document.querySelector('input[type="search"]'));expect(focus).not.toHaveBeenCalled();expect(document.body.scrollTop).toBe(79)
  })

  it.each(['hidden', 'cached', 'unmount', 'config'])('%s 后旧选项、返回、输入与关闭事件全部失效', async reason => {
    await mountPopup();await open('selection');const choose = eventOf(option('deepseek')), close = eventOf(document.querySelector('.service-panel-close')!), back = pickerBack(), input = document.querySelector('input')!, type = eventOf(input,'onInput');invalidate(reason);await settle();const before = snapshot(props.config)
    choose();back();type({target:input});close();expect(snapshot(props.config)).toEqual(before);expect(updates).not.toHaveBeenCalled()
  })
  it('旧选项不能借用后来打开的功能，关闭和返回不能关闭后来的面板', async () => {
    await mountPopup();await open('selection');const choose=eventOf(option('deepseek')), close=eventOf(document.querySelector('.service-panel-close')!), back=pickerBack();back();await settle();await open('hover');const before=snapshot(props.config)
    choose();close();back();await settle();expect(snapshot(props.config)).toEqual(before);expect(updates).not.toHaveBeenCalled();expect(document.querySelector('[data-service-picker]')?.getAttribute('data-service-picker')).toBe('hover')
    eventOf(option('deepseek'))();await settle();expect(props.config.hoverTranslationService).toBe('deepseek');expect(props.config.selectionTranslationService).toBe('');expect(props.config.service).toBe('openai')
  })
  it('概览旧打开和关闭事件在面板往返后失效', async () => {
    await mountPopup();const oldOpen=eventOf(row('hover')), oldClose=eventOf(document.querySelector('.service-panel-close')!);await open('selection');pickerBack()();await settle();oldOpen();oldClose();await settle();expect(document.querySelector('[data-service-picker]')).toBeNull();expect(updates).not.toHaveBeenCalled();eventOf(document.querySelector('.service-panel-close')!)();expect(updates).toHaveBeenCalledOnce()
  })
  it('关闭通知同步使所属控件失效，父级随后重新开启可操作', async () => {
    await mountPopup();await open('selection');const choose=eventOf(option('deepseek')), close=eventOf(document.querySelector('.service-panel-close')!);close();choose();close();expect(updates).toHaveBeenCalledOnce();expect(props.config.selectionTranslationService).toBe('');props.active=false;await settle();props.active=true;await settle();await open('selection');eventOf(option('deepseek'))();expect(props.config.selectionTranslationService).toBe('deepseek')
  })
  it.each(['selected','inherited-default'])('外部 %s 变化关闭旧会话并保留新真值', async kind => {
    await mountPopup();await open('hover');const choose=eventOf(option('deepseek'));if(kind==='selected') props.config.hoverTranslationService='microsoft';else props.config.service='microsoft';await settle();choose();expect(document.querySelector('[data-service-picker]')).toBeNull();expect(props.config.hoverTranslationService).toBe(kind==='selected'?'microsoft':'');expect(props.config.service).toBe(kind==='selected'?'openai':'microsoft');await open('hover');eventOf(option('deepseek'))();expect(props.config.hoverTranslationService).toBe('deepseek')
  })
  it('复验当前目录，停用已选项显示且允许回到继承', async () => {
    const config=runtime.reactive(new Config());config.hoverTranslationService='gone';await mountPopup(config);await open('hover');expect(option('gone').hasAttribute('disabled')).toBe(true);const choose=eventOf(option('deepseek'));props.serviceOptions=[{value:'deepseek',label:'DeepSeek',disabled:true}];await settle();choose();expect(config.hoverTranslationService).toBe('gone');eventOf(option(''))();await settle();expect(config.hoverTranslationService).toBe('')
  })
  it('旧搜索结果与折叠条目不跨查询或展开状态写入', async () => {
    await mountPopup();await open('selection');const choose=eventOf(option('deepseek'));await search('Microsoft');choose();expect(props.config.selectionTranslationService).toBe('');expect(option('microsoft')).not.toBeNull();eventOf(option('microsoft'))();expect(props.config.selectionTranslationService).toBe('microsoft')
  })
  it.each(['hover','selection'])('已删除自定义供应商不能由旧 %s 选项重新分配', async id => {
    const config=runtime.reactive(new Config());config.customOpenAIProviders=[{id:'custom:local',name:'Local',endpoint:'http://localhost/v1',models:['unique-needle']}];await mountPopup(config,{serviceOptions:[...services,{value:'custom:local',label:'Local'}]});await open(id);await search('unique-needle');const choose=eventOf(option('custom:local'));config.customOpenAIProviders=[];await settle();choose();expect(config.hoverTranslationService).toBe('');expect(config.selectionTranslationService).toBe('')
  })
  it('搜索支持配置模型、自定义模型和服务名', async () => {
    const config=runtime.reactive(new Config());config.customModels.deepseek=['unique-needle'];await mountPopup(config);await open('selection');await search('unique needle');expect(option('deepseek').textContent).toContain('unique-needle');await search('Microsoft');expect(option('microsoft')).not.toBeNull()
  })
  it('更多服务默认收起，搜索跨目录且旧控制不能改新面板', async () => {
    await mountPopup(undefined,{serviceOptions:[...services,{value:'ollama',label:'Ollama'}]});await open('selection');const oldMore=eventOf(document.querySelector('.service-picker-more')!), oldType=eventOf(document.querySelector('input')!,'onInput');expect(option('ollama')).toBeNull();oldMore();await settle();expect(option('ollama')).not.toBeNull();eventOf(document.querySelector('.service-picker-more')!)();await settle();expect(option('ollama')).toBeNull();await search('Ollama');expect(option('ollama')).not.toBeNull();const clear=eventOf(document.querySelector('.service-picker-search button')!);clear();await settle();expect((document.querySelector('input') as HTMLInputElement).value).toBe('');expect(option('ollama')).toBeNull();pickerBack()();await settle();await open('hover');oldMore();oldType({target:document.querySelector('input')});await settle();expect(document.querySelector('[data-service-picker]')?.getAttribute('data-service-picker')).toBe('hover');expect((document.querySelector('input') as HTMLInputElement).value).toBe('');expect(option('ollama')).toBeNull()
  })
  it('当前 ArrowDown 和列表方向键导航只访问可用条目，Escape 返回概览', async () => {
    await mountPopup();await open('selection');const prevent=vi.fn(), stop=vi.fn(), input=document.querySelector('input')!;eventOf(input,'onKeydown')({key:'ArrowDown',preventDefault:prevent});expect(focused).toBe(option(''));const list=document.querySelector('[role="listbox"]')!, nav=eventOf(list,'onKeydown');nav({key:'End',target:option(''),preventDefault:prevent});expect(focused).toBe(option('microsoft'));nav({key:'ArrowDown',target:option('microsoft'),preventDefault:prevent});expect(focused).toBe(option(''));nav({key:'Home',target:option('microsoft'),preventDefault:prevent});expect(focused).toBe(option(''));nav({key:'ArrowUp',target:option(''),preventDefault:prevent});expect(focused).toBe(option('microsoft'));nav({key:'x',target:option(''),preventDefault:prevent});expect(prevent).toHaveBeenCalledTimes(5);eventOf(document.querySelector('.popup-service-panel')!,'onKeydown')({key:'Escape',stopPropagation:stop});await settle();expect(stop).toHaveBeenCalledOnce();expect(document.querySelector('[data-service-picker]')).toBeNull()
  })
  it('返回后只恢复所属行，用户主动移走焦点或重开面板时旧任务不抢焦点', async () => {
    await mountPopup();await open('selection');expect(focused).toBe(document.querySelector('input'));pickerBack()();await settle();expect(focused).toBe(row('selection'));eventOf(row('selection'))();const outside=document.createElement('button');document.body.append(outside);focused=outside;focus.mockClear();await settle();expect(focus).not.toHaveBeenCalled();expect(focused).toBe(outside);pickerBack()();await settle();expect(focused).toBe(outside)
  })
  it('回退后尚未渲染便隐藏、替换配置或再次打开，不执行过期焦点任务', async () => {
    await mountPopup();await open('selection');pickerBack()();props.active=false;focus.mockClear();await settle();expect(focus).not.toHaveBeenCalled();props.active=true;await settle();await open('selection');pickerBack()();state.openPicker(state.fields.find((f:any)=>f.id==='hover'));focus.mockClear();await settle();expect(document.querySelector('[data-service-picker]')?.getAttribute('data-service-picker')).toBe('hover');expect(focused).not.toBe(row('selection'))
  })
  it('未声明 active 的普通使用允许默认服务选择', async () => {
    await mountPopup(undefined,{active:undefined});await open('default');eventOf(option('microsoft'))();await settle();expect(props.config.service).toBe('microsoft')
  })
  it.each(['hidden','cached','unmount','config'])('打开后渲染前 %s，不执行旧面板的延迟焦点', async reason => {
    await mountPopup();const el=row('selection') as HTMLElement;el.focus();eventOf(el)();invalidate(reason);focus.mockClear();await settle();expect(focus).not.toHaveBeenCalled()
  })
  it('默认 active 调用关闭后可重新激活缓存组件，旧会话不复活', async () => {
    await mountPopup(undefined,{active:undefined});await open('selection');const old=eventOf(option('deepseek'));eventOf(document.querySelector('.service-panel-close')!)();shown.value=false;await settle();shown.value=true;await settle();old();expect(props.config.selectionTranslationService).toBe('');await open('selection');eventOf(option('deepseek'))();await settle();expect(props.config.selectionTranslationService).toBe('deepseek');expect(updates).toHaveBeenCalledOnce()
  })
})
