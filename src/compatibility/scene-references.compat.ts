import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { loadProject } from './vscode-host';

describe('scene identity diagnostics across validation passes', () => {
  it('retains malformed section diagnostics after an unrelated file changes', async () => {
    const uris = loadProject([
      { name: 'chapter.scene.dry', contents: 'title: Chapter\n\n@side: Invalid inline title\n\nText\n' },
      { name: 'other.scene.dry', contents: 'title: Other\n\nText\n' },
    ]);
    const validator = new DendryProjectValidator();
    for (const changed of [undefined, uris[1]]) {
      const results = await validator.validateProject(uris, changed);
      expect(results.get(uris[0])?.filter(item => /Parser Error:.*section declaration/.test(item.message))).toHaveLength(1);
    }
  });

  it('retains qualified collision diagnostics after an unrelated file changes', async () => {
    const uris = loadProject([
      { name: 'a.scene.dry', contents: 'title: A\n\n@b\ntitle: B\n\nText\n' },
      { name: 'a.b.scene.dry', contents: 'title: Duplicate\n\nText\n' },
      { name: 'other.scene.dry', contents: 'title: Other\n\nText\n' },
    ]);
    const validator = new DendryProjectValidator();
    for (const changed of [undefined, uris[2]]) {
      const results = await validator.validateProject(uris, changed);
      for (const uri of uris.slice(0, 2)) {
        expect(results.get(uri)?.filter(item => /Duplicate scene ID "a.b"/.test(item.message))).toHaveLength(1);
      }
    }
  });

  it('retains a built-in definition error after an unrelated file changes', async () => {
    const uris = loadProject([
      { name: 'returnScene.scene.dry', contents: 'title: Reserved\n\nText\n' },
      { name: 'other.scene.dry', contents: 'title: Other\n\nText\n' },
    ]);
    const validator = new DendryProjectValidator();
    for (const changed of [undefined, uris[1]]) {
      const results = await validator.validateProject(uris, changed);
      expect(results.get(uris[0])?.filter(item => /reserved scene ID/.test(item.message))).toHaveLength(1);
    }
  });
});
