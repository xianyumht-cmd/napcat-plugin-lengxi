# Scene 覆盖率报告

- 统计时间：2026-03-07
- 统计范围：`src/commands/modules/*.ts`
- 统计口径：
  - `sendGroupScene` / `sendPrivateScene` 计为 scene 调用
  - `sendGroupMsg(..., { scene: ... })` 计为 scene 调用
  - scene 参数为 `'raw_text'` 或包含 `'raw_text'` 的条件表达式，计为 raw_text 分支

## 总览

- Scene 调用总数：201
- 非 raw_text 调用：169
- raw_text 调用：32
- 覆盖率（非 raw_text）：84.08%
- 直连旧发送接口（`pluginState.sendGroupText/sendPrivateMsg`）：0

## 模块覆盖率

| 模块 | Scene总数 | raw_text | 非raw | 覆盖率 |
| --- | ---: | ---: | ---: | ---: |
| auth | 13 | 2 | 11 | 84.62% |
| interaction | 29 | 8 | 21 | 72.41% |
| moderation | 49 | 10 | 39 | 79.59% |
| qa | 28 | 3 | 25 | 89.29% |
| risk | 60 | 0 | 60 | 100.00% |
| system | 22 | 9 | 13 | 59.09% |

## 剩余 raw_text 清单（按模块）

### auth.ts（2）
- `sendPrivateScene(..., 'raw_text', 已授权详情...)`：偏状态展示，可保留
- `sendGroupScene(..., 'raw_text', 已授权详情...)`：偏状态展示，可保留

### interaction.ts（8）
- L52：今日已签到提示（`sendGroupMsg`）
- L81：签到榜正文
- L86：我的积分（`sendGroupMsg`）
- L91：邀请查询（`sendGroupMsg`）
- L98：邀请榜正文
- L108：抽奖积分不足（`sendGroupMsg`）
- L122：抽奖结果播报（`sendGroupMsg`）
- L169：积分商城菜单

### moderation.ts（10）
- L64/L68/L71/L88：警告统计与处罚结果描述
- L153：名片锁定列表（条件表达式含 `raw_text`）
- L157：防撤回列表（条件表达式含 `raw_text`）
- L179：针对列表（条件表达式含 `raw_text`）
- L197/L198/L199：黑白名单列表（条件表达式含 `raw_text`）

### qa.ts（3）
- L58：违禁词列表（条件表达式含 `raw_text`）
- L111：拒绝词列表（条件表达式含 `raw_text`）
- L146：问答列表正文

### system.ts（9）
- L58：私聊菜单
- L78：广播开始提示
- L83：获取群列表失败
- L93：广播正文下发
- L100：广播完成统计
- L122：群状态总览
- L154：定时任务列表正文
- L159：危险操作二次确认
- L175：清空失败详情

## 闭环目标

- 阶段目标A：把 `system` 覆盖率从 59.09% 提升到 80%+（优先替换确认/失败/列表类）
- 阶段目标B：把 `interaction` 覆盖率从 72.41% 提升到 90%+（优先替换积分不足与查询提示）
- 阶段目标C：把 `moderation` 覆盖率从 79.59% 提升到 92%+（优先替换处罚结果与列表回执）

## 建议补充 scene（下一轮）

- `status_report`：状态汇总、策略展示、菜单信息
- `operation_warning`：危险操作确认、高风险提醒
- `quota_insufficient`：积分不足、额度不足
- `action_failed`：接口异常、执行失败、下游调用失败
