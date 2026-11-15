// Namespace rules from the pinned upstream dry parser and compiler.
export const BUILTIN_SCENE_IDS = new Set([
  'prevScene', 'prevTopScene', 'jumpScene', 'backSpecialScene', 'returnScene',
]);

export const ABSOLUTE_SCENE_ID = /^[\w-]+(?:\.[\w-]+)*$/;
export const RELATIVE_SCENE_ID = /^(?:\.+|[\w-])[\w-]*(?:\.[\w-]+)*$/;

export function sceneIdFromPath(path: string): string | undefined {
  const basename = path.split(/[/\\]/).pop() || '';
  return basename.endsWith('.scene.dry') ? basename.slice(0, -'.scene.dry'.length) : undefined;
}

export function sceneReferenceCandidates(context: string, reference: string): string[] {
  if (!RELATIVE_SCENE_ID.test(reference)) throw new Error(`Invalid scene reference '${reference}'.`);
  const dots = reference.match(/^\.+/)?.[0].length || 0;
  const extra = reference.slice(dots);
  if (dots === 0) {
    const parts = context ? context.split('.') : [];
    const candidates: string[] = [];
    for (let depth = parts.length; depth > 0; depth--) {
      candidates.push([...parts.slice(0, depth), reference].join('.'));
    }
    return [...candidates, reference];
  }
  if (dots === 1 && extra) return [extra];
  if (!context) throw new Error(`Relative scene reference '${reference}' requires context.`);
  if (dots === 1) return [context];
  const parts = context.split('.');
  if (parts.length < (extra ? dots - 1 : dots)) {
    throw new Error(`Context '${context}' is not deep enough for scene reference '${reference}'.`);
  }
  const parent = parts.slice(0, 1 - dots);
  if (extra) parent.push(extra);
  return [parent.join('.')];
}
