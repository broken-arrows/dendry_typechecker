import * as vscode from 'vscode';

export function validationSettings(resource?: vscode.Uri) {
  const config = vscode.workspace.getConfiguration('dendry', resource);
  return {
    enabled: config.get<boolean>('validation.enable', true),
    dendrynexusTen: config.get<boolean>('validation.dendrynexusTen', false) === true,
    strict: config.get<boolean>('validation.strict', false),
    libraries: config.get<string[]>('validation.jsLibraries', ['d3']),
    exclude: config.get<string[]>('validation.exclude', [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/out/**',
    ]),
  };
}
