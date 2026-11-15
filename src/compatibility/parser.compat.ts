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
        expect(String(choices[0].properties.get('order'))).toBe(option.order);
      } else {
        const ids = ast.nodes.filter(node => node.type === 'scene').map(node => node.properties.get('id'));
        for (const section of expected.sections!) expect(ids).toContain(section.id);
      }
    });
  }
});
