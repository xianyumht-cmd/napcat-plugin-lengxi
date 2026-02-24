import { pluginState } from './state';
import { GroupLicense } from './types';

export type AuthLevel = 'free' | 'pro' | 'enterprise';

export class AuthManager {
  private static instance: AuthManager;
  private checkInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  /**
   * 初始化授权检查
   */
  public init() {
    // 每小时清理过期授权
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      this.cleanExpiredLicenses();
    }, 3600000);
  }

  private cleanExpiredLicenses() {
    const now = Date.now();
    let changed = false;
    if (!pluginState.config.licenses) pluginState.config.licenses = {};
    
    for (const [groupId, license] of Object.entries(pluginState.config.licenses)) {
      if (license.expireTime > 0 && now > license.expireTime) {
        pluginState.log('info', `群 ${groupId} 授权已过期，自动降级为免费版`);
        delete pluginState.config.licenses[groupId];
        changed = true;
      }
    }
    
    if (changed) {
      // 触发保存配置（这里简单处理，实际应调用 saveConfig）
    }
  }

  /**
   * 获取群授权信息
   */
  public getGroupLicense(groupId: string): GroupLicense | null {
    if (!pluginState.config.licenses) return null;
    const license = pluginState.config.licenses[groupId];
    if (!license) return null;
    
    // 检查是否过期
    if (license.expireTime > 0 && Date.now() > license.expireTime) {
      delete pluginState.config.licenses[groupId];
      return null;
    }
    
    return license;
  }

  /**
   * 检查功能权限
   * @param groupId 群号
   * @param feature 功能标识
   */
  public checkFeature(groupId: string, feature: string): boolean {
    const license = this.getGroupLicense(groupId);
    
    // 如果没有授权，拒绝所有需授权功能
    if (!license) return false;

    // 企业版拥有所有权限
    if (license.level === 'enterprise') return true;

    // 专业版权限
    if (license.level === 'pro') {
      const PRO_FEATURES = ['anti_recall', 'regex_qa', 'analytics_detail', 'warning_system', 'curfew', 'group_settings'];
      return PRO_FEATURES.includes(feature);
    }

    return false;
  }

  /**
   * 授予权限
   */
  public grantLicense(groupId: string, days: number, level: AuthLevel = 'pro') {
    if (!pluginState.config.licenses) pluginState.config.licenses = {};
    
    const expireTime = days === -1 ? 0 : Date.now() + days * 24 * 60 * 60 * 1000;
    
    pluginState.config.licenses[groupId] = {
      level,
      expireTime
    };
    
    pluginState.log('info', `群 ${groupId} 已授权 ${level} 版，有效期 ${days === -1 ? '永久' : days + '天'}`);
  }

  /**
   * 回收权限
   */
  public revokeLicense(groupId: string) {
    if (pluginState.config.licenses && pluginState.config.licenses[groupId]) {
      delete pluginState.config.licenses[groupId];
      pluginState.log('info', `群 ${groupId} 授权已回收`);
    }
  }
}

export const authManager = AuthManager.getInstance();
