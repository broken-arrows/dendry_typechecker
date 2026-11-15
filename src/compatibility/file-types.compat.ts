import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

describe('quality and info project integration', () => {
  it('indexes duplicate quality IDs across folders, retains errors, and clears them on deletion', async () => {
    const uris = loadProject([
      { name: 'one/health.quality.dry', contents: 'name: Health\ninitial: 2\n' },
      { name: 'two/health.quality.dry', contents: 'name: Other health\ninitial: healthy\n' },
      { name: 'root.scene.dry', contents: 'title: Root\n\nText\n' },
    ]);
    const validator = new DendryProjectValidator();
    for (const changed of [undefined, uris[2]]) {
      const results = await validator.validateProject(uris, changed);
      for (const uri of uris.slice(0, 2)) {
        expect(results.get(uri)?.filter(item => /Duplicate quality ID "health"/.test(item.message))).toHaveLength(1);
      }
    }
    const afterDeletion = await validator.validateProject([uris[0], uris[2]]);
    expect([...afterDeletion.values()].flat()).toEqual([]);
  });

  it('updates and clears quality schema diagnostics when the quality is edited', async () => {
    const validator = new DendryProjectValidator();
    let uris = loadProject([{ name: 'health.quality.dry', contents: 'initial: 2\n' }]);
    let results = await validator.validateProject(uris);
    expect([...results.values()].flat().filter(item => /name.*missing/.test(item.message))).toHaveLength(1);
    uris = loadProject([{ name: 'health.quality.dry', contents: 'name: Health\ninitial: hopeful\n' }]);
    results = await validator.validateProject(uris, uris[0]);
    expect([...results.values()].flat()).toEqual([]);
  });

  it('warns when info falls back to a missing default root scene', async () => {
    const uris = loadProject([{ name: 'info.dry', contents: 'title: Game\nauthor: Author\n' }]);
    const results = await new DendryProjectValidator().validateProject(uris);
    const diagnostics = [...results.values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].message).toContain("default startup scene 'root'");
  });

  it.each([
    { name: 'health.quality.dry', contents: 'name: Health\n', target: 'health' },
    { name: 'info.dry', contents: 'title: Game\nauthor: Author\n', target: 'info' },
  ])('keeps $name out of the scene namespace', async file => {
    const uris = loadProject([
      file,
      { name: 'root.scene.dry', contents: `title: Root\ngo-to: ${file.target}\n\nText\n` },
    ]);
    const results = await new DendryProjectValidator().validateProject(uris);
    const errors = [...results.values()].flat().filter(item => item.severity === DiagnosticSeverity.Error);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`undefined scene '${file.target}'`);
  });
});
