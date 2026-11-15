import type * as vscode from 'vscode';

/** File identity shared by dirty queues, parsed caches and diagnostics. */
export function uriKey(uri: Pick<vscode.Uri, 'scheme' | 'authority' | 'path'>): string {
  return `${uri.scheme}://${uri.authority.toLowerCase()}${uri.path}`;
}
