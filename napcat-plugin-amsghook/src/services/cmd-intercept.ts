// 指令拦截服务：hook pluginManager.onEvent 实现入站消息拦截
// 仅主人响应：按插件过滤非主人消息
import type { PluginRule } from '../core/types';
import { state } from '../core/state';
import { addLog } from '../core/logger';

let originalOnEvent: Function | null = null;

/** 根据插件名找到对应的 rule */
function findRule (pluginName: string): PluginRule | undefined {
  return state.config.rules.find(r => r.name === pluginName);
}

/**
 * Hook pluginManager.onEvent，在消息分发给各插件之前做拦截
 * 对每个插件单独判断：仅主人响应
 */
export function installCmdInterceptHooks (): void {
  const pm = state.pluginManagerRef;
  if (!pm || !pm.onEvent) return;
  if ((pm.onEvent as any).__cmdIntercept) return;

  originalOnEvent = pm.onEvent.bind(pm);

  pm.onEvent = async function (event: any) {
    // 非消息事件或总开关关闭，直接走原始逻辑
    if (!state.config.enabled || !event?.message_type) {
      return originalOnEvent!(event);
    }

    const senderQQ = String(event.user_id || '');
    const ownerQQ = state.config.ownerQQ || '';
    const groupId = String(event.group_id || '');

    // ===== 全局屏蔽检查 =====
    const blockedGroups = state.config.blockedGroups || [];
    const blockedUsers = state.config.blockedUsers || [];
    if (groupId && blockedGroups.includes(groupId)) {
      if (state.config.debug) addLog('debug', `指令拦截: 群 ${groupId} 已屏蔽，丢弃消息`);
      return;
    }
    if (senderQQ && blockedUsers.includes(senderQQ)) {
      if (state.config.debug) addLog('debug', `指令拦截: 用户 ${senderQQ} 已屏蔽，丢弃消息`);
      return;
    }

    // 获取所有已加载插件 (PluginEntry[])
    const plugins: any[] = pm.getLoadedPlugins?.() || [];

    const tasks = plugins.map(async (entry: any) => {
      const mod = entry.runtime?.module;
      const ctx = entry.runtime?.context;
      const pluginName = entry.id || entry.name || '';

      if (!mod || !ctx) return;
      if (entry.runtime?.status && entry.runtime.status !== 'loaded') return;

      const rule = findRule(pluginName);

      // ===== 仅主人响应检查（全局 or 插件级） =====
      const isOwnerOnly = state.config.globalOwnerOnly || rule?.ownerOnly;
      if (isOwnerOnly && ownerQQ && senderQQ !== ownerQQ) {
        if (pluginName !== 'napcat-plugin-amsghook') {
          if (state.config.debug) addLog('debug', `指令拦截: 非主人 ${senderQQ} → ${pluginName} 已拦截`);
          return;
        }
      }

      // ===== 插件级屏蔽检查 =====
      if (rule) {
        const pBlockedGroups = rule.blockedGroups || [];
        const pBlockedUsers = rule.blockedUsers || [];
        if (groupId && pBlockedGroups.includes(groupId)) {
          if (state.config.debug) addLog('debug', `指令拦截: 群 ${groupId} → ${pluginName} 已屏蔽`);
          return;
        }
        if (senderQQ && pBlockedUsers.includes(senderQQ)) {
          if (state.config.debug) addLog('debug', `指令拦截: 用户 ${senderQQ} → ${pluginName} 已屏蔽`);
          return;
        }
      }

      // 调用插件的事件处理方法
      try {
        if (typeof mod.plugin_onevent === 'function') {
          await mod.plugin_onevent(ctx, event);
        }
        if (event.message_type && typeof mod.plugin_onmessage === 'function') {
          await mod.plugin_onmessage(ctx, event);
        }
      } catch (e: any) {
        addLog('debug', `插件 ${pluginName} 事件处理异常: ${e.message}`);
      }
    });

    await Promise.allSettled(tasks);
  };
  (pm.onEvent as any).__cmdIntercept = true;
  addLog('info', '指令拦截: 已 hook pluginManager.onEvent');
}

/** 卸载钩子 */
export function uninstallCmdInterceptHooks (): void {
  const pm = state.pluginManagerRef;
  if (pm && originalOnEvent) {
    pm.onEvent = originalOnEvent;
    originalOnEvent = null;
    addLog('info', '指令拦截: 已还原 pluginManager.onEvent');
  }
}
