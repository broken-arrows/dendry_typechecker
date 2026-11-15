import * as vscode from 'vscode';
import { DENDRY_FILE_GLOBS, dendryFileKind } from './file-kinds';
import { uriKey } from './uri-key';
import { validationSettings } from './validation-settings';

export interface ProjectInputs { key: string; files: vscode.Uri[] }

/** Workspace folders are independent projects; standalone peers must be open. */
export async function discoverProjects(): Promise<ProjectInputs[]> {
  const projects = await Promise.all((vscode.workspace.workspaceFolders || []).map(async folder => {
    const excludes = validationSettings(folder.uri).exclude;
    const exclude = excludes.length > 1 ? `{${excludes.join(',')}}` : excludes[0] || null;
    const files = (await Promise.all(DENDRY_FILE_GLOBS.map(pattern =>
      vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), exclude)))).flat();
    return {
      key: `workspace:${uriKey(folder.uri)}`,
      files: files.filter(uri => {
        const owner = vscode.workspace.getWorkspaceFolder(uri);
        return owner && uriKey(owner.uri) === uriKey(folder.uri) && dendryFileKind(uri.path) !== undefined;
      }),
    };
  }));
  const standalone = new Map<string, ProjectInputs>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.isClosed || !dendryFileKind(document.uri.path) || vscode.workspace.getWorkspaceFolder(document.uri)) continue;
    if (validationSettings(document.uri).exclude.some(pattern => vscode.languages.match({ pattern }, document) > 0)) continue;
    const parent = document.uri.path.slice(0, document.uri.path.lastIndexOf('/'));
    const key = `standalone:${uriKey({ scheme: document.uri.scheme, authority: document.uri.authority, path: parent })}`;
    let project = standalone.get(key);
    if (!project) { project = { key, files: [] }; standalone.set(key, project); }
    project.files.push(document.uri);
  }
  return [...projects, ...standalone.values()];
}
