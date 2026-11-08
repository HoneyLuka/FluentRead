/**
 * @file tests/settingsControlUiBehavior.test.ts
 * 文件职责：执行设置小组件真实 Vue 客户端模板与输入、切换和生命周期。
 * 主要内容：段落边界归一化、划词开关、词典来源与点选快捷键冲突、语言筛选。
 * 模块边界：布局、子控件和语言端口可控；被测 SFC、Vue 状态与核心归一化函数保持真实。
 */
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createRenderer, h, defineComponent, nextTick, shallowReactive, markRaw, reactive, type App, type Component} from 'vue';
import ParagraphHandlingSettings from '@/src/features/settings/ui/ParagraphHandlingSettings.vue';
import SelectionSettings from '@/src/features/settings/ui/SelectionSettings.vue';
import ExcludedLanguageSettings from '@/src/features/settings/ui/ExcludedLanguageSettings.vue';
import {Config} from '@/src/core/config/model';
import {normalizeEagerTranslationCharacters, normalizeMinTranslationTextLength} from '@/src/core/config/pageTranslation';
import {options, getMultilingualTargetLanguageLabel} from '@/src/core/config/catalog';
const selectionBrowser=vi.hoisted(()=>({browser:'chrome'}));
const feedback=vi.hoisted(()=>({warning:vi.fn()}));
vi.mock('webextension-polyfill',()=>({default:{runtime:{sendMessage:vi.fn()}}}));
vi.mock('element-plus/es/components/alert/style/css',()=>({}));
vi.mock('element-plus',()=>({ElMessage:{success:vi.fn(),warning:feedback.warning},ElMessageBox:{confirm:vi.fn()},
  ElOption:{props:['value','label','disabled'],setup:(props:any)=>()=>h('span',{'data-dictionary-option':props.value,'data-disabled':String(Boolean(props.disabled))},props.label)}}));
vi.mock('@/src/platform/browser/capabilities',()=>({browserCapabilities:selectionBrowser}));
// 保留选择器公开的值与更新事件端口；此套件执行实际设置模板，菜单与 CSS 由生产浏览器专项验证。
vi.mock('@/src/ui/components/UiSelect.vue',()=>({default:{inheritAttrs:false,props:['modelValue','filterable'],emits:['update:modelValue'],setup:(props:any,{attrs,slots,emit}:any)=>()=>h('div',attrs,[
  h('input',{value:props.modelValue,onInput:(event:Event)=>emit('update:modelValue',(event.target as HTMLInputElement).value)}),slots.default?.()])}}));
const locale=vi.hoisted(()=>({value:null as any}));
vi.mock('@/src/ui/i18n', async()=>{const {ref}=await import('vue');locale.value=ref('zh-CN');return{useUiI18n:()=>({language:locale.value,t:(key:string)=>key,translateLegacy:(value:string)=>value})};});
vi.mock('@/src/features/settings/ui/components/SettingsGroup.vue',()=>({default:{setup:(_:unknown,{slots}:any)=>()=>h('section',slots.default?.())}}));
vi.mock('@/src/features/settings/ui/components/SettingsItem.vue',()=>({default:{setup:(_:unknown,{slots}:any)=>()=>h('div',[slots.copy?.(),slots.default?.()])}}));
vi.mock('@/src/features/settings/ui/components/SettingsPreviewLayout.vue',()=>({default:{setup:(_:unknown,{slots}:any)=>()=>h('div',[slots.default?.(),slots.preview?.()])}}));
vi.mock('@/src/features/settings/ui/components/TranslationStylePreview.vue',()=>({default:{props:['pageTheme'],emits:['update:pageTheme'],setup:(props:any,{emit}:any)=>()=>h('button',{'data-preview-theme':props.pageTheme,onClick:()=>emit('update:pageTheme',props.pageTheme==='light'?'dark':'light')},'Preview')}}));
vi.mock('@/src/features/settings/ui/components/SettingsNumberInput.vue',()=>({default:{props:['modelValue'],emits:['update:modelValue','change'],setup:(props:any,{emit,attrs}:any)=>()=>h('input',{...attrs,value:props.modelValue,onChange:(event:Event)=>{const raw=(event.target as HTMLInputElement).value;const value=raw===''?undefined:Number(raw);emit('update:modelValue',value);emit('change',value);}})}}));
vi.mock('@/src/features/settings/ui/components/SegmentedControl.vue',()=>({default:{props:['modelValue','options','disabled'],emits:['update:modelValue'],setup:(props:any,{emit}:any)=>()=>h('div',props.options.map((option:any)=>h('button',{'data-prompt-kind':option.value,disabled:props.disabled,onClick:()=>emit('update:modelValue',option.value)},option.label)))}}));
const SwitchPort=defineComponent({inheritAttrs:false,props:['modelValue'],emits:['update:modelValue'],setup:(props,{attrs,emit})=>()=>h('button',{...attrs,role:'switch','aria-checked':props.modelValue,onClick:()=>emit('update:modelValue',!props.modelValue)},'Switch')});
let doc: Document, win: any;
const apps = new Set<App>();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
async function flush() {for(let i=0;i<16;i++) await nextTick();}
beforeEach(() => {
  selectionBrowser.browser='chrome';feedback.warning.mockReset();
  const parsed=parseHTML('<html><body><main></main></body></html>'); doc=parsed.document as unknown as Document; win=parsed.window;
  for(const key of ['Node','Element','HTMLElement','HTMLButtonElement','SVGElement','Event','MutationObserver']) vi.stubGlobal(key,win[key]);
  vi.stubGlobal('window',win); vi.stubGlobal('document',doc);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++frameId,callback);return frameId;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('innerWidth',1000); vi.stubGlobal('innerHeight',800); vi.stubGlobal('visualViewport',undefined);
  frames.clear(); frameId=0;locale.value.value='zh-CN';
});
afterEach(async()=>{apps.forEach(app=>app.unmount()); apps.clear(); await flush(); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();vi.unstubAllEnvs();});
function mount(component:Component, initial:Record<string,any>, wrapperClass='') {
  const props=shallowReactive(initial); const host=doc.createElement('div'); host.className=wrapperClass; doc.body.append(host);
  const renderer=createRenderer<Node,Element>({
    createElement:(tag,ns)=>markRaw(ns==='svg'?doc.createElementNS('http://www.w3.org/2000/svg',tag):doc.createElement(tag)),
    createText:text=>doc.createTextNode(text),createComment:text=>doc.createComment(text),
    insert:(node,parent,anchor)=>parent.insertBefore(node,anchor||null),remove:node=>node.parentNode?.removeChild(node),
    setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},
    parentNode:node=>node.parentNode as Element|null,nextSibling:node=>node.nextSibling,setScopeId:(node,id)=>node.setAttribute(id,''),
    patchProp(node,key,old,value){
      if(/^on[A-Z]/u.test(key)){const type=key.slice(2).toLowerCase(); if(old)node.removeEventListener(type,old);if(value)node.addEventListener(type,value);}
      else if(key==='value') (node as HTMLInputElement).value=value??'';
      else if(key==='style') {const style=(node as HTMLElement).style;if(typeof value==='string')style.cssText=value;else {for(const k of Object.keys(old||{})) if(!(k in (value||{})))style.removeProperty(k);Object.assign(style,value||{});}}
      else if(value==null||value===false&&key==='disabled')node.removeAttribute(key);
      else node.setAttribute(key,String(value));
    },
    insertStaticContent(html,parent,anchor){const box=doc.createElement('div');box.innerHTML=html;const first=box.firstChild!,last=box.lastChild!;while(box.firstChild)parent.insertBefore(box.firstChild,anchor||null);return[first,last];},
  });
  const app=renderer.createApp({setup:()=>()=>h(component,props)});app.component('ElSwitch', SwitchPort);app.component('ElIcon',{setup:(_:unknown,{slots}:any)=>()=>h('i',slots.default?.())});app.component('ElButton',{inheritAttrs:false,setup:(_:unknown,{attrs,slots}:any)=>()=>h('button',attrs,slots.default?.())});apps.add(app);app.mount(host);
  return {host,props,unmount(){app.unmount();apps.delete(app);}};
}
function button(host:Element,text:string){const found=[...host.querySelectorAll('button')].find(node=>node.textContent===text);expect(found).toBeTruthy();return found!;}
async function click(node:Element){expect(node.hasAttribute('disabled')).toBe(false);node.dispatchEvent(new win.Event('click',{bubbles:true,cancelable:true}));await flush();}
async function input(node:Element,value:string){(node as HTMLInputElement).value=value;node.dispatchEvent(new win.Event('input',{bubbles:true}));await flush();}

it('normalizes paragraph thresholds and changes paragraph layout through real template events',async()=>{
  const config=reactive(new Config());const ui=mount(ParagraphHandlingSettings,{config});
  const fields=[...ui.host.querySelectorAll('input')];
  for(const raw of ['-1','999999999','', '42'])for(const [index,field] of fields.entries()){
    field.value=raw;field.dispatchEvent(new win.Event('change',{bubbles:true}));await flush();
    expect(index===0?config.minTranslationTextLength:config.eagerTranslationCharacters).toBe((index===0?normalizeMinTranslationTextLength:normalizeEagerTranslationCharacters)(raw===''?undefined:Number(raw)));
  }
  const before=config.longParagraphLineBreakEnabled;await click(ui.host.querySelector('[role="switch"]')!);expect(config.longParagraphLineBreakEnabled).toBe(!before);
  const options=ui.host.querySelectorAll('[data-page-translation-order] button');
  await click(options[1]);expect(config.translationBeforeOriginal).toBe(true);
  await click(options[0]);expect(config.translationBeforeOriginal).toBe(false);
  config.display=0;await flush();expect([...options].every(node=>node.hasAttribute('disabled'))).toBe(true);
  expect(config.translationBeforeOriginal).toBe(false);
  await click(button(ui.host,'settings.translationStyle.switchToBilingual'));expect(config.display).toBe(1);
  expect([...options].every(node=>!node.hasAttribute('disabled'))).toBe(true);
});
it.each(['bilingual','translation-only','disabled'] as const)('preserves the previous enabled selection mode from %s',async mode=>{
  const config=reactive(new Config());config.selectionTranslatorMode=mode;const ui=mount(SelectionSettings,{config});
  const toggle=ui.host.querySelector('[role="switch"]')!;await click(toggle);
  if(mode==='disabled'){expect(config.selectionTranslatorMode).toBe('bilingual');expect(config.disableSelectionTranslator).toBe(false);}
  else{expect(config.selectionTranslatorMode).toBe('disabled');expect(config.disableSelectionTranslator).toBe(true);await click(toggle);expect(config.selectionTranslatorMode).toBe(mode);}
});
it('updates dictionary source through the actual settings template',async()=>{
  const config=reactive(new Config());const ui=mount(SelectionSettings,{config});
  const field=ui.host.querySelector<HTMLInputElement>('[data-testid="selection-dictionary-source"] input')!;
  expect(field.value).toBe('auto');
  expect(ui.host.querySelectorAll('[data-dictionary-option]')).toHaveLength(7);
  expect(ui.host.querySelector('[data-dictionary-option="ecdict-local"]')?.getAttribute('data-disabled')).toBe('false');
  expect(ui.host.querySelector('[data-dictionary-option="free-dictionary"]')?.getAttribute('data-disabled')).toBe('false');
  await input(field,'free-dictionary');expect(config.selectionDictionarySource).toBe('free-dictionary');
  config.selectionDictionarySource='wiktionary-rest';await flush();expect(field.value).toBe('wiktionary-rest');
  await input(field,'auto');expect(config.selectionDictionarySource).toBe('auto');
});
it('preserves selected uncommon languages when collapsed, normalizes toggles, clears and relabels after locale changes',async()=>{
  const selected=options.to[options.to.length-1]!.value;let ui:ReturnType<typeof mount>;
  ui=mount(ExcludedLanguageSettings,{modelValue:[selected],'onUpdate:modelValue':(value:string[])=>{ui.props.modelValue=value;}});
  expect(ui.host.querySelectorAll('[data-language]')).toHaveLength(9);expect(ui.host.querySelector(`[data-language="${selected}"]`)).toBeTruthy();
  const first=options.to[0]!;await click(ui.host.querySelector(`[data-language="${first.value}"]`)!);expect(ui.props.modelValue).toContain(first.value);
  await click(ui.host.querySelector(`[data-language="${selected}"]`)!);expect(ui.props.modelValue).not.toContain(selected);expect(ui.host.querySelectorAll('[data-language]')).toHaveLength(8);
  await click(button(ui.host,'settings.excludedLanguages.more'));expect(ui.host.querySelectorAll('[data-language]')).toHaveLength(options.to.length);
  locale.value.value='en';await flush();expect(ui.host.querySelector(`[data-language="${first.value}"] span`)!.textContent).toBe(getMultilingualTargetLanguageLabel(first.value,first.label,'en').split(' / ')[0]);
  await click(button(ui.host,'settings.excludedLanguages.less'));await click(button(ui.host,'settings.excludedLanguages.clear'));expect(ui.props.modelValue).toEqual([]);expect(ui.host.querySelectorAll('.excluded-language-actions button')).toHaveLength(1);
});
it('划词真实开关在停用后重读点选冲突，保留原显示方式并允许显式解除',async()=>{
  const config=reactive(Object.assign(new Config(),{selectionTranslatorMode:'translation-only',disableSelectionTranslator:false,selectionClickSelectEnabled:true}));
  const ui=mount(SelectionSettings,{config});const toggle=ui.host.querySelector('[role="switch"]')!;await click(toggle);
  config.sectionTranslationHotkeyEnabled=true;config.sectionTranslationHotkey='custom';config.customSectionTranslationHotkey='Alt+Shift+S';
  await click(toggle);expect(config.selectionTranslatorMode).toBe('disabled');expect(config.disableSelectionTranslator).toBe(true);expect(feedback.warning).toHaveBeenCalled();
  config.sectionTranslationHotkeyEnabled=false;await click(toggle);expect(config.selectionTranslatorMode).toBe('translation-only');
  await click(toggle);config.sectionTranslationHotkeyEnabled=true;config.selectionClickSelectEnabled=false;await click(toggle);
  expect(config.selectionTranslatorMode).toBe('translation-only');expect(config.disableSelectionTranslator).toBe(false);
});
