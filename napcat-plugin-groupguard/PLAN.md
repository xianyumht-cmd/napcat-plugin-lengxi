# NapCat GroupGuard 商业化改造蓝图

## 1. 项目定位与商业模式

**目标**：将 GroupGuard 从单一的开源群管工具转型为企业级、SaaS 化的智能群管平台。

**商业模式**：
- **免费版 (Free Tier)**：保留基础功能（踢人、禁言、简单入群验证），吸引用户基数。
- **专业版 (Pro Tier)**：提供高级防护（防撤回、云黑名单、正则表达式问答、详细日志），按月/年订阅。
- **企业版 (Enterprise Tier)**：提供多群联管、专属客服、定制化开发、私有化部署支持。

## 2. 功能架构规划

### 2.1 核心功能分级

| 功能模块 | 免费版 | 专业版 | 企业版 |
| :--- | :--- | :--- | :--- |
| **基础群管** | 踢人/禁言/解禁 | + 批量操作/定时任务 | + 跨群同步操作 |
| **入群验证** | 基础数学验证 | + 自定义验证码/图片验证 | + 对接外部系统API验证 |
| **消息审计** | 本地日志 | + 敏感词云端过滤/云端存储 | + 全量消息审计/合规导出 |
| **防撤回** | 仅文本 | + 图片/语音/视频转发 | + 撤回消息永久存档 |
| **黑白名单** | 本地名单 | + 云端共享黑名单库 | + 企业私有黑名单库 |
| **数据统计** | 简单活跃度 | + 详细图表/趋势分析 | + 定制化报表导出 |

### 2.2 技术架构升级

1.  **授权中心 (License Server)**
    -   实现基于 RSA/ECC 签名的 License 发放与验证。
    -   支持在线激活、离线激活（通过文件）。
    -   设备绑定（基于 QQ 号或机器码）。

2.  **云端服务 (Cloud Services)**
    -   **API Gateway**：统一处理插件请求。
    -   **配置同步**：支持多群配置云端备份与恢复。
    -   **插件市场**：支持动态加载扩展模块。

3.  **插件重构**
    -   引入 `FeatureManager` 进行功能模块化管理。
    -   引入 `AuthManager` 进行权限控制。
    -   分离 UI 与 核心逻辑，支持远程 Web 控制台。

## 3. 实施路线图 (Roadmap)

### Phase 1: 基础架构改造 (当前阶段)
- [x] 代码结构分析与整理。
- [ ] 实现 `AuthManager` 模块，支持 License Key 验证。
- [ ] 修改 `Config` 模块，增加授权配置项。
- [ ] 对核心功能点（如防撤回、正则问答）增加授权检查埋点。

### Phase 2: 云端对接与增强
- [ ] 开发简易授权服务端（Mock 或 简单 API）。
- [ ] 实现云端黑名单同步功能。
- [ ] 增加 WebUI 的授权状态显示与激活入口。

### Phase 3: 高级功能开发
- [ ] 开发跨群管理面板。
- [ ] 集成 AI 鉴黄/鉴暴功能（对接第三方 API）。
- [ ] 发布收费体系与会员中心。

## 4. 代码结构调整建议

```
src/
├── core/           # 核心逻辑
│   ├── auth.ts     # 授权管理 (新增)
│   ├── state.ts    # 状态管理
│   └── event.ts    # 事件分发
├── features/       # 功能模块 (模块化)
│   ├── base/       # 基础功能 (Free)
│   │   ├── kick.ts
│   │   └── ban.ts
│   ├── pro/        # 高级功能 (Pro - 需授权)
│   │   ├── anti-recall.ts
│   │   └── cloud-blacklist.ts
│   └── manager.ts  # 功能管理器
├── services/       # 外部服务
│   ├── api.ts      # NapCat API 封装
│   └── cloud.ts    # 云端 API (新增)
├── utils/          # 工具函数
├── config.ts       # 配置定义
└── index.ts        # 入口
```

## 5. 商业授权验证示例逻辑

```typescript
// src/core/auth.ts
export class AuthManager {
    private licenseKey: string;
    private status: 'free' | 'pro' | 'enterprise' = 'free';

    async validate() {
        // 1. 检查本地格式
        // 2. 发起云端验证 (携带机器码/QQ)
        // 3. 更新 status 状态
        // 4. 定时重新验证
    }

    check(feature: string): boolean {
        if (this.status === 'enterprise') return true;
        if (this.status === 'pro' && PRO_FEATURES.includes(feature)) return true;
        return FREE_FEATURES.includes(feature);
    }
}
```
