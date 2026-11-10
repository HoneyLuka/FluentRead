import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {App} from 'vue';
import type {DriveSyncPreview, DriveSyncStatus} from '@/src/services/config/remoteConfigSync';

const dom = await vi.hoisted(async () => {
  const {parseHTML} = await import('linkedom');const {window, document} = parseHTML('<html><body></body></html>');
  for (const name of ['window','document','Node','Element','HTMLElement','SVGElement','Event','CustomEvent']) Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:(window as any)[name]});
  return {window,document};
});
const mocks = vi.hoisted(() => {
    const updatedListeners = new Set<(tabId: number, change: {url?: string}) => void>();
    const removedListeners = new Set<(tabId: number) => void>();
    const created: {url: string; id: number}[] = [];
    const removed: number[] = [];
    return {
        send: vi.fn(),
        errors: [] as unknown[],
        messages: [] as Record<string, unknown>[],
        created,
        removed,
        tabs: {
            create: vi.fn(async ({url}: {url: string}) => {const tab = {url, id: 9100 + created.length}; created.push(tab); return tab;}),
            remove: vi.fn(async (id: number) => {removed.push(id); for (const listener of [...removedListeners]) listener(id);}),
            onUpdated: {addListener: (fn: (tabId: number, change: {url?: string}) => void) => void updatedListeners.add(fn), removeListener: (fn: (tabId: number, change: {url?: string}) => void) => void updatedListeners.delete(fn)},
            onRemoved: {addListener: (fn: (tabId: number) => void) => void removedListeners.add(fn), removeListener: (fn: (tabId: number) => void) => void removedListeners.delete(fn)},
        },
        emitUpdated: (tabId: number, change: {url?: string}) => {for (const listener of [...updatedListeners]) listener(tabId, change);},
        emitRemoved: (tabId: number) => {for (const listener of [...removedListeners]) listener(tabId);},
    };
});
import * as Vue from 'vue';
import GoogleDriveSync from '@/src/features/settings/ui/GoogleDriveSync.vue';
import {deriveWebOauthChallenge} from '@/src/platform/google-drive/webOauth';
vi.mock('webextension-polyfill',()=>({default:{runtime:{sendMessage:mocks.send},tabs:mocks.tabs}}));
vi.mock('@/src/ui/i18n',()=>({useUiI18n:()=>({t:(key:string)=>key,translateLegacy:(text:string)=>text,language:Vue.ref('zh-CN')})}));
vi.mock('@element-plus/icons-vue',()=>Object.fromEntries(['ArrowDown','ArrowLeft','ArrowRight','ArrowUp','CircleCheck','Delete','Download','Switch','Upload','User','Warning'].map(name=>[name,{render:()=>null}])));
vi.mock('element-plus/es/components/alert/style/css',()=>({}));
vi.mock('element-plus/es/components/button/style/css',()=>({}));
vi.mock('element-plus/es/components/input/style/css',()=>({}));
vi.mock('element-plus/es/components/pagination/style/css',()=>({}));
vi.mock('element-plus/es/components/popover/style/css',()=>({}));
vi.mock('element-plus/es/components/switch/style/css',()=>({}));
vi.mock('element-plus',()=>({
  ElMessage:{success:(...args:unknown[])=>mocks.messages.push({kind:'success',args}),error:(...args:unknown[])=>mocks.messages.push({kind:'error',args})},
  ElButton:{props:['disabled'],setup:(props:any,{attrs,slots}:any)=>()=>Vue.h('button',{...attrs,type:'button',disabled:props.disabled},slots.default?.())},
  ElAlert:{props:['title','description'],setup:(props:any)=>()=>Vue.h('div',{role:'alert'},[props.title,props.description])},
  ElIcon:{setup:(_:unknown,{slots}:any)=>()=>Vue.h('i',slots.default?.())},
  ElInput:{props:['modelValue','disabled'],emits:['update:modelValue'],setup:(props:any,{attrs,emit}:any)=>()=>Vue.h('input',{...attrs,value:props.modelValue,disabled:props.disabled,onInput:(event:Event)=>emit('update:modelValue',(event.target as HTMLInputElement).value)})},
  ElSwitch:{props:['modelValue','disabled'],emits:['update:modelValue','change'],setup:(props:any,{attrs,emit}:any)=>()=>Vue.h('button',{...attrs,type:'button',role:'switch',disabled:props.disabled,'aria-checked':String(props.modelValue),onClick:()=>{emit('update:modelValue',!props.modelValue);emit('change',!props.modelValue)}})},
  ElPopover:{props:['visible'],emits:['update:visible'],setup:(props:any,{slots,emit}:any)=>()=>Vue.h('div',{'data-popover-visible':String(props.visible)},[slots.reference?.(),Vue.h('button',{'data-popover-visibility':'',onClick:()=>emit('update:visible',!props.visible)},'Toggle details'),slots.default?.()])},
  ElPagination:{props:['currentPage'],emits:['update:currentPage'],setup:(props:any,{emit}:any)=>()=>Vue.h('button',{'data-next-page':'',onClick:()=>emit('update:currentPage',props.currentPage+1)},'Next page')},
}));
const apps=new Set<App>();const storage=new Map<string,string>();
async function settle(){for(let i=0;i<16;i++){await Promise.resolve();await Vue.nextTick();}for(let round=0;round<2;round++){await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<6;i++){await Promise.resolve();await Vue.nextTick();}}}
const account={id:'drive:fixture-permission',email:'fixture@example.test'};
const redirectUri='https://callback.example/oauth';
function statusFixture(patch: Partial<DriveSyncStatus> = {}): DriveSyncStatus {return {available: true, reason: '', account: null, lastSyncedAt: null, ...patch};}
const nativeStatus = statusFixture();
const signedOutStatus = statusFixture({webOauth: {clientId: 'fixture-web-client.apps.googleusercontent.com', redirectUri, signedIn: false}});
const signedInStatus = statusFixture({webOauth: {clientId: 'fixture-web-client.apps.googleusercontent.com', redirectUri, signedIn: true}});
function preview(patch: Partial<DriveSyncPreview> = {}): DriveSyncPreview {return {id: 'preview-1', account, hasRemote: false, includeSensitive: false, remoteIncludesSensitive: false, hasBaseline: false, changes: [], expiresAt: Date.now() + 60_000, ...patch};}
beforeEach(()=>{
  mocks.send.mockReset();mocks.errors.length=0;mocks.messages.length=0;mocks.created.length=0;mocks.removed.length=0;
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  dom.document.body.replaceChildren();
});
afterEach(async()=>{for(const app of apps)app.unmount();apps.clear();await settle();expect(mocks.errors).toEqual([]);vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mountSync(){const host=dom.document.createElement('main');dom.document.body.append(host);let exposed:any;
  const app=Vue.createApp({render:()=>Vue.h(GoogleDriveSync,{ref:(value:any)=>{exposed=value}})});
  app.component('el-button',{props:['disabled'],setup:(props:any,{attrs,slots}:any)=>()=>Vue.h('button',{...attrs,type:'button',disabled:props.disabled},slots.default?.())});
  app.component('el-dialog',{props:['modelValue','beforeClose','showClose'],emits:['closed','update:modelValue'],setup:(props:any,{attrs,slots,emit}:any)=>{Vue.watch(()=>props.modelValue,(value,previous)=>{if(previous&&!value){emit('closed');emit('update:modelValue',false)}});const close=()=>{const done=()=>emit('update:modelValue',false);if(props.beforeClose)props.beforeClose(done);else done();};return()=>props.modelValue?Vue.h('section',{...attrs,role:'dialog'},[props.showClose!==false?Vue.h('button',{'data-dialog-close':'',onClick:close},'Close dialog'):null,slots.default?.(),slots.footer?.()]):null}});
  const {ElSwitch}=await import('element-plus');app.component('el-switch',ElSwitch);
  app.config.warnHandler=()=>{};app.config.errorHandler=error=>mocks.errors.push(error);app.mount(host);apps.add(app);await settle();
  return {host,get exposed(){return exposed},stop:()=>{app.unmount();apps.delete(app)}};
}
async function click(host:HTMLElement,selector:string){const element=host.querySelector<HTMLButtonElement>(selector);expect(element,selector).not.toBeNull();expect(element!.disabled,selector).toBe(false);element!.click();await settle();}
function route(handler:(message:Record<string,any>)=>{success:boolean;data?:unknown;error?:string}|undefined){mocks.send.mockImplementation(async (message:Record<string,any>)=>handler(message) ?? {success:true,data:{}});}
function defaultRoute(status: DriveSyncStatus){route(message=>{
  if(message.action==='status')return {success:true,data:status};
  if(message.action==='prepare')return {success:true,data:preview()};
  if(message.action==='connect')return {success:true,data:signedInStatus};
  if(message.action==='signOut')return {success:true,data:signedOutStatus};
  return {success:true,data:undefined};
});}
function authorizationUrl(){expect(mocks.created, '授权页签').toHaveLength(1);return new URL(mocks.created[0].url);}

describe('GoogleDriveSync 真实 SFC 的 Web OAuth 连接',()=>{
  it('Chrome 原生路径保持默认同步按钮，不打开任何授权页签',async()=>{
    defaultRoute(nativeStatus);
    const view=await mountSync();
    expect(view.host.querySelector('[data-testid="google-drive-web-connect"]')).toBeNull();
    const button=view.host.querySelector<HTMLButtonElement>('[data-testid="google-drive-sync-now"]');
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain('settings.cloud.syncNow');
    await click(view.host,'[data-testid="google-drive-sync-now"]');
    expect(mocks.created).toHaveLength(0);
    expect(mocks.send.mock.calls.map(call=>call[0].action)).toEqual(['status','status','prepare']);
  });
  it('未连接时通过页签截获授权码：PKCE、state 校验、后台 connect 后继续同步',async()=>{
    let current=signedOutStatus;
    route(message=>{
      if(message.action==='status')return {success:true,data:current};
      if(message.action==='prepare')return {success:true,data:preview()};
      if(message.action==='connect')return {success:true,data:signedInStatus};
      return {success:true,data:undefined};
    });
    const view=await mountSync();
    expect(view.host.querySelector('[data-testid="google-drive-web-sign-out"]')).toBeNull();
    await click(view.host,'[data-testid="google-drive-web-connect"]');
    const url=authorizationUrl();
    expect(url.origin+url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('fixture-web-client.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
    const state=url.searchParams.get('state')!;
    expect(state).toBeTruthy();
    // 中间导航与无关页签不触发连接。
    mocks.emitUpdated(9999,{url:'https://accounts.google.com/signin'});
    mocks.emitUpdated(mocks.created[0].id,{url:'https://other.example/oauth?code=x&state='+state});
    expect(mocks.send).toHaveBeenCalledTimes(2);
    mocks.emitUpdated(mocks.created[0].id,{url:`${redirectUri}?code=4%2F0Ax4Xb-fixture-code&state=${state}`});
    await settle();
    expect(mocks.removed).toEqual([mocks.created[0].id]);
    const connect=mocks.send.mock.calls.map(call=>call[0]).find(message=>message.action==='connect');
    expect(connect).toMatchObject({type:'googleDriveEncryptedSync',code:'4/0Ax4Xb-fixture-code',clientId:expect.any(String)});
    expect(typeof connect!.codeVerifier).toBe('string');
    await expect(deriveWebOauthChallenge(connect!.codeVerifier as string)).resolves.toBe(url.searchParams.get('code_challenge'));
    // connect 成功后刷新状态并继续共用预览；按钮切换回“立即同步”。
    const actions=mocks.send.mock.calls.map(call=>call[0].action);
    expect(actions).toEqual(['status','status','connect','prepare']);
    current=signedInStatus;
    await view.exposed.refreshStatus();
    expect(view.host.querySelector('[data-testid="google-drive-web-connect"]')).toBeNull();
    expect(view.host.querySelector('[data-testid="google-drive-sync-now"]')).not.toBeNull();
  });
  it.each([
      ['settings.cloud.webAuthStateInvalid',(state:string)=>`?code=4%2F0Ax4Xb-fixture&state=wrong-${state}`],
      ['settings.cloud.webAuthDenied',(state:string)=>`?error=access_denied&state=${state}`],
      ['settings.cloud.webAuthTabClosed',()=>'' ],
  ] as const)('%s 时不发送 connect 且不关闭页签（关闭场景除外）',async(key,build)=>{
    defaultRoute(signedOutStatus);
    const view=await mountSync();
    await click(view.host,'[data-testid="google-drive-web-connect"]');
    const url=authorizationUrl();
    if(key==='settings.cloud.webAuthTabClosed') mocks.emitRemoved(mocks.created[0].id);
    else mocks.emitUpdated(mocks.created[0].id,{url:`${redirectUri}${build(url.searchParams.get('state')!)}`});
    await settle();
    expect(mocks.send.mock.calls.some(call=>call[0].action==='connect')).toBe(false);
    expect(mocks.send.mock.calls.some(call=>call[0].action==='prepare')).toBe(false);
    expect(view.host.textContent).toContain(key);
    if(key!=='settings.cloud.webAuthTabClosed') expect(mocks.removed).toHaveLength(0);
    expect(view.host.querySelector('.drive-dialog')).toBeNull();
  });
  it('已连接时同步直接预览；更换账号强制重新走同意页；退出连接后回到连接入口',async()=>{
    let current=signedInStatus;
    route(message=>{
      if(message.action==='status')return {success:true,data:current};
      if(message.action==='prepare')return {success:true,data:preview({hasRemote:true,changes:[{id:'theme',label:'Theme',local:'开启',remote:'关闭',recommended:null,sensitive:false,conflict:true}]})};
      if(message.action==='connect')return {success:true,data:signedInStatus};
      if(message.action==='signOut')return {success:true,data:signedOutStatus};
      return {success:true,data:undefined};
    });
    const view=await mountSync();
    expect(view.host.querySelector('[data-testid="google-drive-web-connect"]')).toBeNull();
    await click(view.host,'[data-testid="google-drive-sync-now"]');
    expect(mocks.created).toHaveLength(0);
    // 预览打开后，更换账号在已连接状态下仍强制打开 Google 同意页。
    await click(view.host,'[data-testid="google-drive-switch-account"]');
    const url=authorizationUrl();
    const state=url.searchParams.get('state')!;
    mocks.emitUpdated(mocks.created[0].id,{url:`${redirectUri}?code=4%2F0Ax4Xb-second&state=${state}`});
    await settle();
    const actions=mocks.send.mock.calls.map(call=>call[0].action);
        expect(actions).toEqual(['status','status','prepare','status','connect','cancel','status','prepare']);
    // 退出连接后刷新回连接入口。
    await click(view.host,'[data-testid="google-drive-web-sign-out"]');
    expect(mocks.send.mock.calls.filter(call=>call[0].action==='signOut')).toHaveLength(1);
    current=signedOutStatus;
    await view.exposed.refreshStatus();
    expect(view.host.querySelector('[data-testid="google-drive-web-connect"]')).not.toBeNull();
    expect(mocks.messages).toContainEqual({kind:'success',args:['settings.cloud.webSignedOut']});
  });
  it('后台 connect 失败时透出安全提示，不继续预览',async()=>{
    defaultRoute(signedOutStatus);
    mocks.send.mockImplementation(async (message:Record<string,any>)=>{
      if(message.action==='status')return {success:true,data:signedOutStatus};
      if(message.action==='connect')return {success:false,error:'Google 未返回长期授权，请重新连接 Google 账号。'};
      return {success:true,data:undefined};
    });
    const view=await mountSync();
    await click(view.host,'[data-testid="google-drive-web-connect"]');
    const url=authorizationUrl();
    mocks.emitUpdated(mocks.created[0].id,{url:`${redirectUri}?code=4%2F0Ax4Xb-fixture&state=${url.searchParams.get('state')}`});
    await settle();
    expect(view.host.textContent).toContain('Google 未返回长期授权');
    expect(mocks.send.mock.calls.some(call=>call[0].action==='prepare')).toBe(false);
  });
});
