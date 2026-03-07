# 命令覆盖报告（新模块路由）

- 基准清单来源：`scripts/legacy_command_manifest.json`
- 目标：移除 legacy 命令链后，全部由 `auth/moderation/interaction/risk/qa/system` 新路由命中并处理
- 结论：当前基准命令均已在新 matcher 中可命中，且在对应模块内存在处理分支

## 总览

- 命令总数：136（exact + prefix）
- matcher 命中：136
- 处理分支覆盖：136
- 未匹配命令：0

## Auth

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 授权 | prefix | ✅ auth | ✅ |
| 回收授权 | prefix | ✅ auth | ✅ |
| 查询授权 | prefix/exact | ✅ auth | ✅ |
| 授权状态 | exact | ✅ auth | ✅ |
| 授权查询 | exact | ✅ auth | ✅ |
| 激活 | prefix | ✅ auth | ✅ |

## System

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 帮助 | exact | ✅ system | ✅ |
| 菜单 | exact | ✅ system | ✅ |
| 群管帮助 | exact | ✅ system | ✅ |
| 群管菜单 | exact | ✅ system | ✅ |
| 查看SQLite状态 | exact | ✅ system | ✅ |
| 查看存储状态 | exact | ✅ system | ✅ |
| 多群广播 | prefix | ✅ system | ✅ |
| 运行状态 | exact | ✅ system | ✅ |
| 设置欢迎词 | prefix | ✅ system | ✅ |
| 定时任务 | prefix | ✅ system | ✅ |
| 删除定时任务 | prefix | ✅ system | ✅ |
| 定时列表 | exact | ✅ system | ✅ |
| 清空群配置 | exact | ✅ system | ✅ |
| 确认清空群配置 | exact | ✅ system | ✅ |

## Interaction

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 签到 | exact | ✅ interaction | ✅ |
| 签到榜 | exact | ✅ interaction | ✅ |
| 我的积分 | exact | ✅ interaction | ✅ |
| 抽奖 | exact | ✅ interaction | ✅ |
| 积分商城 | exact | ✅ interaction | ✅ |
| 商城 | exact | ✅ interaction | ✅ |
| 兑换 | prefix | ✅ interaction | ✅ |
| 邀请查询 | exact | ✅ interaction | ✅ |
| 邀请榜 | exact | ✅ interaction | ✅ |
| 开启发言奖励 | prefix | ✅ interaction | ✅ |
| 关闭发言奖励 | exact | ✅ interaction | ✅ |
| 活跃统计 | prefix | ✅ interaction | ✅ |
| 查封号 | prefix | ✅ interaction | ✅ |
| 查隐藏 | prefix | ✅ interaction | ✅ |
| 设置lolurl | prefix | ✅ interaction | ✅ |
| 设置lolkey | prefix | ✅ interaction | ✅ |
| 设置loltoken | prefix | ✅ interaction | ✅ |

## Moderation

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 警告 | prefix | ✅ moderation | ✅ |
| 清除警告 | prefix | ✅ moderation | ✅ |
| 查看警告 | prefix | ✅ moderation | ✅ |
| 踢出 | prefix | ✅ moderation | ✅ |
| 禁言 | prefix | ✅ moderation | ✅ |
| 解禁 | prefix | ✅ moderation | ✅ |
| 全体禁言 | exact | ✅ moderation | ✅ |
| 全体解禁 | exact | ✅ moderation | ✅ |
| 授予头衔 | prefix | ✅ moderation | ✅ |
| 清除头衔 | prefix | ✅ moderation | ✅ |
| 锁定名片 | prefix | ✅ moderation | ✅ |
| 解锁名片 | prefix | ✅ moderation | ✅ |
| 名片锁定列表 | exact | ✅ moderation | ✅ |
| 开启防撤回 | exact | ✅ moderation | ✅ |
| 关闭防撤回 | exact | ✅ moderation | ✅ |
| 防撤回列表 | exact | ✅ moderation | ✅ |
| 开启回应表情 | exact | ✅ moderation | ✅ |
| 关闭回应表情 | exact | ✅ moderation | ✅ |
| 针对 | prefix | ✅ moderation | ✅ |
| 取消针对 | prefix | ✅ moderation | ✅ |
| 针对列表 | exact | ✅ moderation | ✅ |
| 清除针对 | exact | ✅ moderation | ✅ |
| 开启自身撤回 | prefix | ✅ moderation | ✅ |
| 关闭自身撤回 | exact | ✅ moderation | ✅ |
| 拉黑 | prefix | ✅ moderation | ✅ |
| 取消拉黑 | prefix | ✅ moderation | ✅ |
| 黑名单列表 | exact | ✅ moderation | ✅ |
| 群拉黑 | prefix | ✅ moderation | ✅ |
| 群取消拉黑 | prefix | ✅ moderation | ✅ |
| 群黑名单列表 | exact | ✅ moderation | ✅ |
| 白名单 | prefix | ✅ moderation | ✅ |
| 取消白名单 | prefix | ✅ moderation | ✅ |
| 白名单列表 | exact | ✅ moderation | ✅ |

## QA

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 添加违禁词 | prefix | ✅ qa | ✅ |
| 添加全局违禁词 | prefix | ✅ qa | ✅ |
| 删除违禁词 | prefix | ✅ qa | ✅ |
| 删除全局违禁词 | prefix | ✅ qa | ✅ |
| 设置违禁词惩罚 | prefix | ✅ qa | ✅ |
| 设置违禁词禁言 | prefix | ✅ qa | ✅ |
| 违禁词列表 | exact | ✅ qa | ✅ |
| 添加拒绝词 | prefix | ✅ qa | ✅ |
| 添加全局拒绝词 | prefix | ✅ qa | ✅ |
| 删除拒绝词 | prefix | ✅ qa | ✅ |
| 删除全局拒绝词 | prefix | ✅ qa | ✅ |
| 拒绝词列表 | exact | ✅ qa | ✅ |
| 问答列表 | exact | ✅ qa | ✅ |
| 模糊问 | prefix | ✅ qa | ✅ |
| 精确问 | prefix | ✅ qa | ✅ |
| 添加正则问答 | prefix | ✅ qa | ✅ |
| 添加问答 | prefix | ✅ qa | ✅ |
| 添加模糊问答 | prefix | ✅ qa | ✅ |
| 删除问答 | prefix | ✅ qa | ✅ |
| 删问 | prefix | ✅ qa | ✅ |

## Risk

| 命令 | 类型 | 新路由命中 | 处理状态 |
| --- | --- | --- | --- |
| 风控设置 | exact | ✅ risk | ✅ |
| 安全设置 | exact | ✅ risk | ✅ |
| 设置权限缓存 | prefix | ✅ risk | ✅ |
| 开启宵禁 | prefix | ✅ risk | ✅ |
| 关闭宵禁 | exact | ✅ risk | ✅ |
| 设置复读阈值 | prefix | ✅ risk | ✅ |
| 屏蔽 | prefix | ✅ risk | ✅ |
| 取消屏蔽 | prefix | ✅ risk | ✅ |
| 开启刷屏检测 | exact | ✅ risk | ✅ |
| 关闭刷屏检测 | exact | ✅ risk | ✅ |
| 设置刷屏窗口 | prefix | ✅ risk | ✅ |
| 设置刷屏阈值 | prefix | ✅ risk | ✅ |
| 设置刷屏禁言 | prefix | ✅ risk | ✅ |
| 开启入群验证 | exact | ✅ risk | ✅ |
| 关闭入群验证 | exact | ✅ risk | ✅ |
| 开启自动审批 | exact | ✅ risk | ✅ |
| 关闭自动审批 | exact | ✅ risk | ✅ |
| 开启退群拉黑 | exact | ✅ risk | ✅ |
| 关闭退群拉黑 | exact | ✅ risk | ✅ |
| 设置入群暗号 | prefix | ✅ risk | ✅ |
| 设置暗号 | prefix | ✅ risk | ✅ |
| 关闭入群暗号 | exact | ✅ risk | ✅ |
| 开启暗号回落 | exact | ✅ risk | ✅ |
| 关闭暗号回落 | exact | ✅ risk | ✅ |
| 开启功能 | prefix | ✅ risk | ✅ |
| 关闭功能 | prefix | ✅ risk | ✅ |
| 开启二维码撤回 | exact | ✅ risk | ✅ |
| 关闭二维码撤回 | exact | ✅ risk | ✅ |
| 开启调试 | exact | ✅ risk | ✅ |
| 关闭调试 | exact | ✅ risk | ✅ |
| 开启随机后缀 | exact | ✅ risk | ✅ |
| 关闭随机后缀 | exact | ✅ risk | ✅ |
| 开启全局自身撤回 | exact | ✅ risk | ✅ |
| 关闭全局自身撤回 | exact | ✅ risk | ✅ |
| 设置随机延迟 | prefix | ✅ risk | ✅ |
| 设置发送队列模式 | prefix | ✅ risk | ✅ |
| 设置发送并发 | prefix | ✅ risk | ✅ |
| 设置全局限流 | prefix | ✅ risk | ✅ |
| 设置问答冷却 | prefix | ✅ risk | ✅ |
| 设置用户冷却 | prefix | ✅ risk | ✅ |
| 设置分级冷却 | prefix | ✅ risk | ✅ |
| 设置群熔断 | prefix | ✅ risk | ✅ |
| 设置回复概率 | prefix | ✅ risk | ✅ |
| 设置回复模板 | prefix | ✅ risk | ✅ |
| 查看发送策略 | exact | ✅ risk | ✅ |

## 未匹配命令

- 无

## 灰度测试建议

- 阶段1（1天）：仅观察路由命中日志，不执行策略变更。
- 阶段2（2天）：灰度 10% 群，重点验证高频命令（签到、禁言、问答、黑白名单）。
- 阶段3（2天）：灰度 50% 群，开启异常告警（命令未命中、权限分支、API错误）。
- 阶段4（1天）：全量切换，保留一键回滚开关（按域回滚）。
