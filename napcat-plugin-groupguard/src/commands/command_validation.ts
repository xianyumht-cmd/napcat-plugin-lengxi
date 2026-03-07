import type { CommandDomain } from './types';

export type RouteDomain = Exclude<CommandDomain, 'unknown'>;

export interface CommandModuleValidationTarget {
  domain: RouteDomain;
  prefixes: string[];
  exact: string[];
  matcher?: ((text: string) => string | null) | null;
  handler?: unknown;
}

export interface CommandValidationIssue {
  code: 'duplicate_matcher' | 'matcher_without_handler' | 'handler_unregistered' | 'matcher_missing';
  message: string;
}

export interface CommandValidationResult {
  issues: CommandValidationIssue[];
  warningCount: number;
}

function isFunction(v: unknown): v is Function {
  return typeof v === 'function';
}

function findDuplicateWarnings(targets: CommandModuleValidationTarget[]): CommandValidationIssue[] {
  const mapping = new Map<string, string[]>();
  for (const t of targets) {
    for (const p of t.prefixes) {
      const key = `prefix:${p}`;
      const arr = mapping.get(key) || [];
      arr.push(`${t.domain}.PREFIXES`);
      mapping.set(key, arr);
    }
    for (const e of t.exact) {
      const key = `exact:${e}`;
      const arr = mapping.get(key) || [];
      arr.push(`${t.domain}.EXACT`);
      mapping.set(key, arr);
    }
  }
  const issues: CommandValidationIssue[] = [];
  for (const [k, refs] of mapping.entries()) {
    if (refs.length > 1) {
      issues.push({
        code: 'duplicate_matcher',
        message: `命令匹配重复: ${k} -> ${refs.join(', ')}`
      });
    }
  }
  return issues;
}

export function validateCommandRouting(targets: CommandModuleValidationTarget[], registeredDomains: RouteDomain[]): CommandValidationResult {
  const issues: CommandValidationIssue[] = [];
  issues.push(...findDuplicateWarnings(targets));
  const registered = new Set<RouteDomain>(registeredDomains);
  for (const t of targets) {
    const hasMatcherEntries = t.prefixes.length > 0 || t.exact.length > 0;
    const hasMatcher = isFunction(t.matcher);
    const hasHandler = isFunction(t.handler);
    if (hasMatcherEntries && !hasMatcher) {
      issues.push({
        code: 'matcher_missing',
        message: `模块 ${t.domain} 存在 PREFIXES/EXACT 但未提供 matcher`
      });
    }
    if (hasMatcherEntries && hasMatcher && !registered.has(t.domain)) {
      issues.push({
        code: 'matcher_without_handler',
        message: `模块 ${t.domain} 存在 matcher 但未注册到路由 handler`
      });
    }
    if (hasHandler && !registered.has(t.domain)) {
      issues.push({
        code: 'handler_unregistered',
        message: `模块 ${t.domain} 存在 handler 但未注册到路由`
      });
    }
  }
  for (const d of registeredDomains) {
    const found = targets.find(t => t.domain === d);
    if (!found) {
      issues.push({
        code: 'handler_unregistered',
        message: `路由已注册 domain=${d}，但未找到模块 matcher/定义`
      });
    }
  }
  return { issues, warningCount: issues.length };
}
