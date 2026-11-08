/**
 * @file src/core/config/featureServices.ts
 * 文件职责：定义功能与翻译服务的对应关系，供设置中心统一展示与修改现有配置字段。
 * 主要内容：区分继承默认与独立翻译服务的功能，集中解析当前服务和有效模型。
 * 模块边界：只操作调用方传入的配置草稿，不保存数据、不调用供应商、不维护第二份功能状态；各运行时继续读取原有配置字段。
 */
import type {Config} from './model';
import {resolveConfiguredModel} from './catalog';
import type {CustomOpenAIProvider} from './customOpenAI';

export const featureServiceDefinitions = [
    {id: 'hover', field: 'hoverTranslationService', inherit: true, aiOnly: false},
    {id: 'selection', field: 'selectionTranslationService', inherit: true, aiOnly: false},
] as const;
export type FeatureServiceDefinition = typeof featureServiceDefinitions[number];

/** 全部功能均无 AI-only 限制；保留签名供设置中心统一调用。 */
export function isFeatureServiceSupported(_feature: FeatureServiceDefinition, _service: string, _customProviders: readonly CustomOpenAIProvider[] = []): boolean {
    return true;
}

export function getFeatureService(config: Config, feature: FeatureServiceDefinition): string {
    return config[feature.field];
}

export function setFeatureService(config: Config, feature: FeatureServiceDefinition, service: string): void {
    if (getFeatureService(config, feature) === service) return;
    config[feature.field] = service;
}

export function getFeatureModel(config: Config, feature: FeatureServiceDefinition): string {
    const service = getFeatureService(config, feature) || config.service;
    return resolveConfiguredModel(config.model[service], config.customModel[service]);
}
