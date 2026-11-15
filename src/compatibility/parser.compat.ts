import { describe, expect, it } from 'vitest';
import { parseText } from '../parser';
import { corpus, oracle, projectFiles } from './corpus';

describe('parsing preserves upstream source semantics', () => {
  for (const testCase of corpus.cases.filter(item => item.parser)) {
    it(`${testCase.id}: ${testCase.description}`, () => {
      const request = testCase.parser!;
      const file = projectFiles(testCase).find(item => item.name === request.file)!;
      const expected = oracle.cases[testCase.id].parsed!;
      const { ast, errors } = parseText(file.contents, file.name);
      expect(errors).toEqual([]);

      if (request.check === 'root-content') {
        const root = ast.nodes.find(node => node.type === 'scene' && node.properties.get('id') === expected.id);
        expect(root, `Root scene ${expected.id} must survive parsing`).toBeDefined();
        expect(root!.properties.get('title')).toBe(expected.title);
        expect(root!.content.trim()).toBe(expected.content);
        if (testCase.id === 'blank-separates-properties') {
          expect(root!.properties.has('subtitle')).toBe(false);
          expect(ast.metadata.subtitle).toBeUndefined();
        }
      } else if (request.check === 'choice-properties') {
        const choices = ast.nodes.filter(node => node.type === 'choice');
        expect(choices).toHaveLength(expected.options!.length);
        const option = expected.options![0];
        expect(choices[0].properties.get('id')).toBe(option.id);
        expect(choices[0].properties.get('title')).toBe(option.title);
        expect(choices[0].properties.get('choose-if')).toBe(option.chooseIf);
        expect(choices[0].properties.get('order')).toBe(option.order);
      } else if (request.check === 'section-ids') {
        const ids = ast.nodes.filter(node => node.type === 'scene').map(node => node.properties.get('id'));
        for (const section of expected.sections!) expect(ids).toContain(section.id);
      } else {
        const kind = request.check === 'quality-file' ? 'quality' : 'info';
        expect(ast.nodes).toHaveLength(1);
        const node = ast.nodes[0];
        expect(node.type).toBe(kind);
        expect(node.properties.get('id')).toBe(expected.id);
        expect(node.content.trim()).toBe(expected.content?.trim() || '');
        if (kind === 'quality') {
          expect(node.properties.get('name')).toBe(expected.name);
          expect(node.properties.get('initial')).toBe(expected.initial);
          expect(node.properties.get('min')).toBe(expected.min);
          expect(node.properties.get('max')).toBe(expected.max);
          expect(node.properties.get('is-valid')).toBe(expected.isValid);
          expect(node.properties.get('default-display')).toBe(expected.defaultDisplay);
          expect(node.properties.get('signal')).toBe(expected.signal);
        } else {
          expect(node.properties.get('title')).toBe(expected.title);
          expect(node.properties.get('author')).toBe(expected.author);
          expect(node.properties.get('first-scene')).toBe(expected.firstScene);
          expect(node.properties.get('root-scene')).toBe(expected.rootScene);
        }
      }
    });
  }
});
