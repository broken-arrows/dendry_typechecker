import { SCENE_SCHEMA, ScenePropertyKind } from './scene-schema';

export type EngineId = 'dendrynexus' | 'dendrynexus-ten';
type InfoPropertyKind = 'opaque' | 'type' | 'boolean' | 'tags' | 'reference' | 'version';

export interface EngineProfile {
  readonly id: EngineId;
  readonly sceneSchema: Readonly<Record<string, ScenePropertyKind | 'role'>>;
  readonly choiceProperties: ReadonlySet<string>;
  readonly infoSchema: Readonly<Record<string, InfoPropertyKind>>;
}

const choiceProperties = [
  'id', 'title', 'subtitle', 'unavailable-subtitle', 'view-if', 'choose-if',
  'order', 'frequency', 'frequency-var', 'priority',
];
const infoSchema: EngineProfile['infoSchema'] = {
  id: 'opaque', type: 'type', title: 'opaque', author: 'opaque', ifid: 'opaque',
  'first-scene': 'reference', 'root-scene': 'reference',
  animate: 'boolean', 'scene-signal': 'opaque', 'quality-signal': 'opaque',
  'display-sidebar': 'boolean', 'display-stats': 'boolean', 'display-options': 'boolean',
  'sidebar-stats': 'tags',
};

const upstream: EngineProfile = {
  id: 'dendrynexus', sceneSchema: SCENE_SCHEMA,
  choiceProperties: new Set(choiceProperties), infoSchema,
};
const ten: EngineProfile = {
  id: 'dendrynexus-ten',
  sceneSchema: { ...SCENE_SCHEMA, role: 'role', 'choice-image': 'opaque' },
  choiceProperties: new Set([...choiceProperties, 'choice-image']),
  infoSchema: { ...infoSchema, version: 'version', languages: 'tags' },
};

export function engineProfile(dendrynexusTen: boolean): EngineProfile {
  return dendrynexusTen ? ten : upstream;
}

// TEN's agreed authoring contract accepts any casing and compiles roles to
// lowercase. The editor validates authored text without rewriting its AST.
const roles = [
  'desk', 'deck', 'deck-gov', 'deck-party', 'deck-parliament',
  'card', 'card-gov', 'card-party', 'card-parliament',
  'pinned-action', 'pinned-advisor', 'pinned-parliament', 'newspaper', 'event',
  'status', 'info-tab', 'pause-item', 'title-hub', 'main-menu-item', 'library-item',
  'setup', 'intro', 'ending', 'default',
];

export function roleError(value: string): string | undefined {
  if (!roles.includes(value.trim().toLowerCase())) return `Role must be one of: ${roles.join(', ')}.`;
}

export function gameVersionError(value: string): string | undefined {
  // This is the engine's game-version syntax, not npm semver.
  if (!/^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(value.trim())) {
    return 'Version must be major.minor or major.minor.patch, optionally followed by -tag.';
  }
}
