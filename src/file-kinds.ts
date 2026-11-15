export type DendryFileKind = 'scene' | 'quality' | 'info' | 'qdisplay';

export const DENDRY_FILE_GLOBS = [
  '**/*.scene.dry', '**/*.quality.dry', '**/info.dry', '**/*.qdisplay.dry',
];

export function dendryFileKind(path: string): DendryFileKind | undefined {
  const name = path.split(/[/\\]/).pop() || '';
  if (name === 'info.dry') return 'info';
  if (name.endsWith('.scene.dry')) return 'scene';
  if (name.endsWith('.quality.dry')) return 'quality';
  if (name.endsWith('.qdisplay.dry')) return 'qdisplay';
  return undefined;
}
