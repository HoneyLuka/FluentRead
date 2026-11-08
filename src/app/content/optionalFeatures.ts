/**
 * @file src/app/content/optionalFeatures.ts
 * 文件职责：管理内容页按需挂载的局部翻译入口的配置驱动生命周期。
 * 主要内容：为局部翻译入口创建受 activation signal 所有的子控制器，按总开关与站点禁用状态挂载，并在页面销毁时统一释放。
 * 模块边界：这里只编排 content 生命周期，不实现区域选择或配置持久化；具体行为属于 section-translation 与 config store。
 */
type SiteAwareContentFeatureMount = (options: {isSiteDisabled: () => boolean}, signal: AbortSignal) => void;

export interface OptionalContentFeatureConfig {
    on?: boolean;
}

export interface OptionalContentFeatureDependencies {
    activationSignal: AbortSignal;
    config: OptionalContentFeatureConfig;
    isSiteDisabled: () => boolean;
    /** 局部翻译入口：Popup 按钮随时可用，快捷键由功能内部按配置判断，因此只随总开关与站点状态挂载。 */
    mountSectionTranslationContentFeature: SiteAwareContentFeatureMount;
}

export interface OptionalContentFeatureRuntime {
    sync(): void;
    dispose(): void;
}

export function createOptionalContentFeatureRuntime(
    dependencies: OptionalContentFeatureDependencies,
): OptionalContentFeatureRuntime {
    let sectionTranslationFeatureController: AbortController | null = null;
    let disposed = false;

    const createChildController = (): AbortController => {
        const child = new AbortController();
        if (dependencies.activationSignal.aborted) {
            child.abort();
            return child;
        }
        const abortChild = (): void => child.abort();
        dependencies.activationSignal.addEventListener('abort', abortChild, {once: true});
        child.signal.addEventListener('abort', () => {
            dependencies.activationSignal.removeEventListener('abort', abortChild);
        }, {once: true});
        return child;
    };

    const sectionTranslationFeatureEnabled = (): boolean => dependencies.config.on === true
        && !dependencies.isSiteDisabled();

    const sync = (): void => {
        if (disposed || dependencies.activationSignal.aborted) return;
        if (sectionTranslationFeatureEnabled()) {
            if (!sectionTranslationFeatureController) {
                sectionTranslationFeatureController = createChildController();
                if (!sectionTranslationFeatureController.signal.aborted) {
                    dependencies.mountSectionTranslationContentFeature(
                        {isSiteDisabled: dependencies.isSiteDisabled},
                        sectionTranslationFeatureController.signal,
                    );
                }
            }
        } else if (sectionTranslationFeatureController) {
            sectionTranslationFeatureController.abort();
            sectionTranslationFeatureController = null;
        }
    };

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        sectionTranslationFeatureController?.abort();
        sectionTranslationFeatureController = null;
    };

    return {sync, dispose};
}
