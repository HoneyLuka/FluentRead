import {describe, expect, it} from 'vitest';
import {
    DEFAULT_SECTION_TRANSLATION_HOTKEY,
    SECTION_TRANSLATION_HOTKEY_OPTIONS,
    matchesSectionTranslationHotkey,
    normalizeCustomSectionTranslationHotkey,
    normalizeSectionTranslationHotkey,
    resolveSectionTranslationHotkey,
    sectionTranslationHotkeyDisplayName,
} from '@/src/core/config/sectionTranslation';

function keyboardEvent(overrides: Record<string, unknown> = {}): KeyboardEvent {
    return {
        key: 'r',
        code: 'KeyR',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...overrides,
    } as unknown as KeyboardEvent;
}

describe('局部翻译快捷键配置', () => {
    it('默认组合键避开全文和浏览器菜单键，预设全部带修饰键', () => {
        expect(DEFAULT_SECTION_TRANSLATION_HOTKEY).toBe('Alt+R');
        const presets = SECTION_TRANSLATION_HOTKEY_OPTIONS.map((option) => option.value);
        expect(presets).toContain(DEFAULT_SECTION_TRANSLATION_HOTKEY);
        for (const occupied of ['Alt+T', 'Alt+E', 'Alt+F', 'Alt+S']) {
            expect(presets).not.toContain(occupied);
        }
        for (const option of SECTION_TRANSLATION_HOTKEY_OPTIONS) {
            expect(option.value).toMatch(/^(?:Alt|Shift|Ctrl)\+/u);
            expect(option.label.length).toBeGreaterThan(0);
        }
    });

    it('预设只接受列表内的组合键，其余取值回到默认值', () => {
        expect(normalizeSectionTranslationHotkey('custom')).toBe('custom');
        expect(normalizeSectionTranslationHotkey('alt+x')).toBe('Alt+X');
        expect(normalizeSectionTranslationHotkey('Ctrl+Alt+R')).toBe('Ctrl+Alt+R');
        for (const invalid of [undefined, 42, 'none', 'Ctrl+C', 'r']) {
            expect(normalizeSectionTranslationHotkey(invalid)).toBe(DEFAULT_SECTION_TRANSLATION_HOTKEY);
        }
    });

    it('自定义组合键保存为规范写法，无法解析时留空', () => {
        expect(normalizeCustomSectionTranslationHotkey('alt+k')).toBe('Alt+K');
        expect(normalizeCustomSectionTranslationHotkey('')).toBe('');
        expect(normalizeCustomSectionTranslationHotkey(undefined)).toBe('');
        expect(normalizeCustomSectionTranslationHotkey(7)).toBe('');
    });

    it('选择自定义却没有录制成功时回到默认值，展示名称跟随平台写法', () => {
        expect(resolveSectionTranslationHotkey('Shift+R', 'Alt+K')).toBe('Shift+R');
        expect(resolveSectionTranslationHotkey('custom', 'alt+k')).toBe('Alt+K');
        expect(resolveSectionTranslationHotkey('custom', '')).toBe(DEFAULT_SECTION_TRANSLATION_HOTKEY);
        expect(sectionTranslationHotkeyDisplayName('custom', 'alt+k')).toMatch(/^(?:Alt|Option)\+K$/u);
        expect(sectionTranslationHotkeyDisplayName('Alt+R', '')).toMatch(/^(?:Alt|Option)\+R$/u);
    });

    it('按键匹配要求修饰键完全一致，Mac 上 Option 改写的字符按物理键匹配', () => {
        expect(matchesSectionTranslationHotkey(keyboardEvent({altKey: true}), 'Alt+R', '')).toBe(true);
        expect(matchesSectionTranslationHotkey(keyboardEvent({altKey: true, key: '®'}), 'Alt+R', '')).toBe(true);
        expect(matchesSectionTranslationHotkey(keyboardEvent({altKey: true, shiftKey: true}), 'Alt+R', '')).toBe(false);
        expect(matchesSectionTranslationHotkey(keyboardEvent({ctrlKey: true}), 'Alt+R', '')).toBe(false);
        expect(matchesSectionTranslationHotkey(keyboardEvent({altKey: true, key: 'k', code: 'KeyK'}), 'custom', 'Alt+K')).toBe(true);
    });
});
