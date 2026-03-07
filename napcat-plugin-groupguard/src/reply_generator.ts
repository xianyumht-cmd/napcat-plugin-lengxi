import type { GroupGuardSettings, ReplyPersona, ReplySceneTemplateMap } from './types';
import { BUILTIN_REPLY_SCENE_TEMPLATES, PERSONA_LABELS, PERSONA_LIST } from './reply_templates';

export interface ReplyGenerateInput {
  scene: string;
  raw?: string;
  vars?: Record<string, string | number | boolean>;
  persona?: ReplyPersona;
  settings: GroupGuardSettings;
}

export interface ReplyGenerateOutput {
  text: string;
  scene: string;
  persona: ReplyPersona;
}

const BUILTIN_SCENE_TEMPLATES = BUILTIN_REPLY_SCENE_TEMPLATES;
const lastTemplateIndex = new Map<string, number>();

function normalizePersona(value: string | undefined): ReplyPersona {
  if (value === 'friendly' || value === 'strict' || value === 'humor' || value === 'professional' || value === 'gentle') return value;
  return 'formal';
}

function renderVars(template: string, vars: Record<string, string | number | boolean>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function pickRandom<T>(list: T[], dedupeKey?: string): T | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  if (list.length === 1) return list[0];
  let idx = Math.floor(Math.random() * list.length);
  if (dedupeKey) {
    const last = lastTemplateIndex.get(dedupeKey);
    if (last !== undefined && idx === last) {
      idx = (idx + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    }
    lastTemplateIndex.set(dedupeKey, idx);
  }
  return list[idx];
}

function mergeTemplates(settings: GroupGuardSettings): ReplySceneTemplateMap {
  const custom = settings.replySceneTemplates || {};
  return { ...BUILTIN_SCENE_TEMPLATES, ...custom };
}

function pickPersona(input: ReplyGenerateInput): ReplyPersona {
  if (input.persona) return normalizePersona(input.persona);
  if (input.settings.autoRandomPersona) {
    return PERSONA_LIST[Math.floor(Math.random() * PERSONA_LIST.length)] || 'formal';
  }
  return normalizePersona(
    input.settings.replyPersonaByScene?.[input.scene]
      || input.settings.replyPersonaDefault
      || 'formal'
  );
}

export function generateReply(input: ReplyGenerateInput): ReplyGenerateOutput {
  const { scene, raw = '', settings } = input;
  const merged = mergeTemplates(settings);
  const persona = pickPersona(input);
  const vars = { raw, ...(input.vars || {}) };
  const sceneEntry = merged[scene] || merged.raw_text;
  const list = sceneEntry?.personaTemplates?.[persona]
    || sceneEntry?.personaTemplates?.formal
    || ['{raw}'];
  const selected = pickRandom(list, `${scene}:${persona}`) || '{raw}';
  const text = renderVars(selected, vars);
  return { text, scene, persona };
}

export function getReplyTemplateCatalog(): { personas: Record<string, string>; templates: ReplySceneTemplateMap; } {
  return {
    personas: PERSONA_LABELS,
    templates: BUILTIN_SCENE_TEMPLATES
  };
}
