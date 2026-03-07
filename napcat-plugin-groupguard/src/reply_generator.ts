import type { GroupGuardSettings, ReplyPersona, ReplySceneTemplateMap } from './types';

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

const BUILTIN_SCENE_TEMPLATES: ReplySceneTemplateMap = {
  permission_denied: {
    personaTemplates: {
      formal: ['需要管理员权限'],
      friendly: ['这个操作需要管理员权限哦～'],
      strict: ['拒绝执行：权限不足'],
      humor: ['权限不够，先升级再来']
    }
  },
  action_success: {
    personaTemplates: {
      formal: ['操作成功'],
      friendly: ['完成啦 ✅'],
      strict: ['执行完成'],
      humor: ['搞定，流程丝滑']
    }
  },
  raw_text: {
    personaTemplates: {
      formal: ['{raw}'],
      friendly: ['{raw}'],
      strict: ['{raw}'],
      humor: ['{raw}']
    }
  }
};

function normalizePersona(value: string | undefined): ReplyPersona {
  if (value === 'friendly' || value === 'strict' || value === 'humor') return value;
  return 'formal';
}

function renderVars(template: string, vars: Record<string, string | number | boolean>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function pickRandom<T>(list: T[]): T | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

function mergeTemplates(settings: GroupGuardSettings): ReplySceneTemplateMap {
  const custom = settings.replySceneTemplates || {};
  return { ...BUILTIN_SCENE_TEMPLATES, ...custom };
}

export function generateReply(input: ReplyGenerateInput): ReplyGenerateOutput {
  const { scene, raw = '', settings } = input;
  const merged = mergeTemplates(settings);
  const persona = normalizePersona(
    input.persona
      || settings.replyPersonaByScene?.[scene]
      || settings.replyPersonaDefault
      || 'formal'
  );
  const vars = { raw, ...(input.vars || {}) };
  const sceneEntry = merged[scene] || merged.raw_text;
  const list = sceneEntry?.personaTemplates?.[persona]
    || sceneEntry?.personaTemplates?.formal
    || ['{raw}'];
  const selected = pickRandom(list) || '{raw}';
  const text = renderVars(selected, vars);
  return { text, scene, persona };
}
