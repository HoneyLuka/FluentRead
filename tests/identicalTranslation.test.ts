import {describe, expect, it} from 'vitest';
import {hasDistinctTranslation, hasTranslationContent} from '@/src/core/translation/result';

describe('相同译文只保留原文', () => {
    it.each([
        ['', false], [' \n\t\u3000', false], ['\u200b', false], [' \u200b\t\u200b', false],
        ['\u200c', true], ['\u200d', true], ['+', true], ['=', true], ['0', true], ['中文\u200b', true],
    ])('有效内容判定 %j：%s，保留连接符与数学语义', (text, content) => {
        expect(hasTranslationContent(text as string)).toBe(content);
    });
    it.each([
        ['Hello world', 'Hello world', false],
        ['Hello  world', '  Hello\nworld\u3000', false],
        ['Café', 'Cafe\u0301', false],
        ['Amber Meadow', 'Amber Meadow\u200b', false],
        ['原文', '原\u200b文', false],
        ['', '\u200b', false],
        ['a\u200bb', 'a b', true],
        ['原文', '', false],
        ['原文', ' \n ', false],
        ['原文', undefined, false],
        ['原文', '译文', true],
        ['Hello', 'hello', true],
        ['Hello!', 'Hello?', true],
        ['允许清空', '允許清空', true],
        ['a b', 'ab', true],
        ['👩‍💻', '👩💻', true],
        ['می\u200cروم', 'میروم', true],
    ])('比较 %j 和 %j 时是否显示译文：%s', (source, translation, visible) => {
        expect(hasDistinctTranslation(source!, translation)).toBe(visible);
    });
});
