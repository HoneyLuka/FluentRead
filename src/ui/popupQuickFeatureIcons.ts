/**
 * @file src/ui/popupQuickFeatureIcons.ts
 * 文件职责：集中保存菜单栏快捷入口的图标数据，让真实菜单栏与设置页里的菜单栏预览使用同一份图形。
 * 主要内容：按快捷入口 ID 提供 24×24 画布上的线条图标路径，以及图标的色调名；默认风格按色调名上色，部分传统色风格也按它分配各自的颜色。
 * 模块边界：只导出静态展示数据，不读取配置、不决定入口是否显示，也不包含任何点击行为；入口的文案与状态由调用方提供。
 */
import type {PopupQuickFeatureId} from '@/src/core/config/interfaceAppearance'

export type PopupQuickFeatureIconTone = 'rose' | 'violet' | 'amber' | 'teal' | 'blue'

/** 快捷入口采用一致的线宽与画布；配色由皮肤控制。 */
export const popupQuickFeatureIconPaths: Record<PopupQuickFeatureId, string> = {
  hover: 'M5 3l14 10-7 1-3 7-4-18z M12 14l5 6',
  selection: 'M8 4h8 M12 4v16 M8 20h8 M5 8H3v8h2 M19 8h2v8h-2',
  appearance: 'M3 19L9 5l6 14 M5 15h8 M16 12c5-3 6 1 5 7 M21 15c-7-2-6 6 0 3',
}

export const popupQuickFeatureIconTones: Record<PopupQuickFeatureId, PopupQuickFeatureIconTone> = {
  hover: 'rose',
  selection: 'violet',
  appearance: 'amber',
}
