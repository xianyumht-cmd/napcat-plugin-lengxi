// NapCat 插件自动更新管理器
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path from 'path';
import type { PluginConfig } from './types';
import { DEFAULT_CONFIG } from './config';
import { pluginState } from './state';
import { handleCommand } from './commands';
import { registerApiRoutes } from './api';
import { startScheduler, stopScheduler } from './scheduler';

export let plugin_config_ui: PluginConfigSchema = [];

const PREFIX = '更新';

const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  Object.assign(pluginState, {
    logger: ctx.logger,
    actions: ctx.actions,
    adapterName: ctx.adapterName,
    networkConfig: ctx.pluginManager.config,
    pluginManager: ctx.pluginManager,
    configPath: ctx.configPath,
  });

  pluginState.log('info', '插件自动更新管理器初始化中...');

  // 配置 UI
  try {
    const C = ctx.NapCatConfig;
    if (C) {
      plugin_config_ui = C.combine(
        C.html(`
          <div style="padding:16px;background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(30,41,59,0.1));border:1px solid rgba(139,92,246,0.3);border-radius:12px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
              <div style="width:36px;height:36px;background:rgba(139,92,246,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              </div>
              <div>
                <h3 style="margin:0;font-size:16px;font-weight:600;">插件自动更新 v${pluginState.version}</h3>
                <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">napcat-plugin-autoupdate</p>
              </div>
            </div>
            <p style="margin:0;font-size:13px;color:#6b7280;">
              自动检查并更新已安装的 NapCat 插件 |
              发送 <code style="background:rgba(139,92,246,0.15);padding:2px 6px;border-radius:4px;color:#8b5cf6;">更新帮助</code> 查看指令
            </p>
          </div>
        `),
        C.html(`
          <div style="padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;display:flex;gap:10px;align-items:center;">
            <div style="color:#6b7280;flex-shrink:0;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></div>
            <div style="font-size:13px;color:#4b5563;">
              请前往
              <a href="#" onclick="window.open(window.location.origin+'/plugin/napcat-plugin-autoupdate/page/config','_blank');return false;" style="color:#8b5cf6;font-weight:600;">WebUI 控制台</a>
              进行详细配置。
            </div>
          </div>
        `),
        C.boolean('debug', '调试模式', false, '显示详细日志'),
      );
    }
  } catch { /* ignore */ }

  // 注册 WebUI
  const router = (ctx as any).router;
  registerApiRoutes(router);
  router.page({ path: 'config', title: '插件自动更新', icon: '🔄', htmlFile: 'webui/config.html', description: '插件更新管理面板' });

  // 加载配置
  if (fs.existsSync(ctx.configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      pluginState.config = { ...DEFAULT_CONFIG, ...raw };
    } catch { /* ignore */ }
  }

  // 启动定时检查
  startScheduler();

  pluginState.log('info', '插件自动更新管理器初始化完成');
};

export const plugin_get_config = async (): Promise<PluginConfig> => pluginState.config;
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
  const raw = config as any;
  if (raw.debug !== undefined) pluginState.config.debug = Boolean(raw.debug);
  pluginState.saveConfig();
};

const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  stopScheduler();
  pluginState.log('info', '插件自动更新管理器已卸载');
};

const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== 'message') return;
  const raw = (event.raw_message || '').trim();

  const match = raw.match(new RegExp(`^${PREFIX}\\s*(.*)`, 'is'));
  if (!match) return;

  await handleCommand(event, match[1].trim(), ctx);
};

export { plugin_init, plugin_onmessage, plugin_cleanup };
