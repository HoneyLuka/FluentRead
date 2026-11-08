/**
 * @file src/app/content/features.ts
 * 文件职责：定义 content composition root 可使用的 feature 公共面，集中汇总页面翻译、局部翻译、悬浮球和划词能力。
 * 主要内容：汇总当前网页显示模式即时同步端口；从独立 UI 出口装配进度面板，重导出各 feature 的 mount/unmount、状态查询、全文翻译控制与选择文本规范化，让 runtime 只依赖经过审核的 public 契约。
 * 模块边界：该 barrel 不创建实例、不执行翻译，也不越过 public.ts 读取 feature 内部实现；能力装配和生命周期在 content/runtime，业务逻辑归各 src/features 子模块。
 */
export {
    cancelPendingHoverTranslation,
    handleTranslation,
    autoTranslateEnglishPage,
    invalidateFullPageTranslationSessionCache,
    isFullPageTranslationActive, getTranslationToolbarStatus, getFullPageTranslationDiagnostic, getFullPageTranslationDocumentToken, readFullPageUnchangedCompletion,
    getFullPageTranslationFrameState,
    noteBilingualHostGesture,
    resetFullPageTranslationRouteState,
    createPageTranslationDisplayModeSync,
    restoreOriginalContent,
} from '@/src/features/full-page-translation/public';
export {
    mountTranslationProgressPanel,
    unmountTranslationProgressPanel,
} from '@/src/features/full-page-translation/ui/public';
export {
    isFloatingBallAllowedOnPage,
    mountFloatingBall,
    toggleFloatingBallTranslation,
    unmountFloatingBall,
} from '@/src/features/floating-ball/public';
export { mountHoverTranslationContentFeature } from '@/src/features/hover-translation/public';
export {
    mountSectionTranslationContentFeature,
    startSectionTranslationPicker,
} from '@/src/features/section-translation/public';
export {
    mountSelectionTranslator,
    translateSelectionFromContextMenu,
    unmountSelectionTranslator,
} from '@/src/features/selection-translation/public';
export {
    isSameLanguage,
    normalizeSelectionText,
    readSelectionText,
    shouldIgnoreSelection,
} from '@/src/features/selection-translation/public';
