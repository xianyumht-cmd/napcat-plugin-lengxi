// 群管插件类型定义

/** 消息类型检测过滤配置 */
export interface MsgFilterSettings {
  /** 自动撤回视频 */
  blockVideo: boolean;
  /** 自动撤回图片 */
  blockImage: boolean;
  /** 自动撤回语音 */
  blockRecord: boolean;
  /** 自动撤回合并转发 */
  blockForward: boolean;
  /** 自动撤回小程序卡片 */
  blockLightApp: boolean;
  /** 自动撤回名片分享 */
  blockContact: boolean;
  /** 自动撤回含链接消息 */
  blockUrl: boolean;
  /** 自动撤回二维码图片 */
  blockQr: boolean;
}

export interface PluginConfig {
  licenseKey?: string;
  debug: boolean;
  ownerQQs: string;
  licenses: Record<string, GroupLicense>;
  global: GroupGuardSettings;
  groups: Record<string, GroupGuardSettings>;
  antiRecallGroups: string[];
  globalAntiRecall: boolean;
  globalEmojiReact: boolean;
  emojiReactGroups: Record<string, string[]>;
  cardLocks: Record<string, string>;
  blacklist: string[];
  whitelist: string[];
  filterKeywords: string[];
  filterPunishLevel: number;
  filterBanMinutes: number;
  welcomeMessage: string;
  spamWindow: number;
  spamThreshold: number;
  spamDetect: boolean;
  spamBanMinutes: number;
  /** 退群自动拉黑 */
  leaveBlacklist: boolean;
  /** LOL战绩查询 Token */
  lolToken?: string;
  /** 自定义战绩查询接口地址 (例如 http://example.com/query.php) */
  lolQueryUrl?: string;
  /** 自定义战绩查询授权码 (zhanjikey) */
  lolAuthKey?: string;
  /** 全局消息类型过滤 */
  msgFilter: MsgFilterSettings;
  /** 全局问答列表 */
  qaList: QAEntry[];
  /** 入群审核拒绝关键词 */
  rejectKeywords: string[];
  /** 预设配置列表 */
  presets: PresetConfig[];
}

export interface GroupGuardSettings {
  useGlobal?: boolean;
  autoApprove: boolean;
  enableVerify: boolean;
  verifyTimeout: number;
  maxAttempts: number;
  mathMin: number;
  mathMax: number;
  targetUsers: string[];
  /** 群独立黑名单 */
  groupBlacklist: string[];
  /** 入群审核拒绝关键词（验证信息包含则拒绝） */
  rejectKeywords?: string[];
  /** 退群自动拉黑（群级别） */
  leaveBlacklist: boolean;
  /** 欢迎词（群级别，空则用全局） */
  welcomeMessage?: string;
  /** 违禁词列表（群级别，空则用全局） */
  filterKeywords?: string[];
  /** 违禁词惩罚等级 */
  filterPunishLevel?: number;
  /** 违禁词禁言时长（分钟） */
  filterBanMinutes?: number;
  /** 刷屏检测开关 */
  spamDetect?: boolean;
  /** 刷屏时间窗口（秒） */
  spamWindow?: number;
  /** 刷屏消息阈值 */
  spamThreshold?: number;
  /** 刷屏禁言时长（分钟） */
  spamBanMinutes?: number;
  /** 复读检测阈值（连续N条相同消息） */
  repeatThreshold?: number;
  /** 权限缓存时间 (秒)，0为关闭 */
  adminCacheSeconds?: number;
  /** 群独立消息类型过滤 */
  msgFilter?: MsgFilterSettings;
  /** 群独立问答列表 */
  qaList?: QAEntry[];
  /** 警告上限次数 */
  warningLimit?: number;
  /** 警告惩罚：ban=禁言, kick=踢出 */
  warningAction?: 'ban' | 'kick';
  /** 宵禁开始时间 (HH:mm) */
  curfewStart?: string;
  /** 宵禁结束时间 (HH:mm) */
  curfewEnd?: string;
  /** 是否开启宵禁 */
  enableCurfew?: boolean;
  /** 定时任务列表 */
  scheduledTasks?: ScheduledTask[];
  /** 发言奖励积分 */
  messageReward?: number;
  /** 签到最小积分 */
  signinMin?: number;
  /** 签到最大积分 */
  signinMax?: number;
  /** 邀请奖励积分 */
  invitePoints?: number;
  /** 抽奖消耗积分 */
  lotteryCost?: number;
  /** 抽奖最大奖励积分 */
  lotteryReward?: number;
  /** 自动撤回机器人自己发的消息 */
  autoRecallSelf?: boolean;
  /** 自动撤回延迟（秒） */
  autoRecallSelfDelay?: number;
  /** 随机后缀（防复读风控） */
  randomSuffix?: boolean;
  /** 随机延迟发送（毫秒） */
  randomDelayMin?: number;
  randomDelayMax?: number;
  /** 发送队列模式：global=全局队列, group=分群队列 */
  queueMode?: 'global' | 'group';
  /** 发送并发数（同一时间最多发送N条） */
  queueConcurrency?: number;
  /** 每分钟全局最大发送量（TokenBucket） */
  globalMaxPerMinute?: number;
  /** 超限后是否仅排队等待令牌（true=等待，false=直接丢弃） */
  rateLimitEnqueue?: boolean;
  /** 自动回复触发概率（0-100） */
  replyProbability?: number;
  /** 自动回复模板池，使用 {msg} 占位 */
  replyTemplatePool?: string[];
  /** 问答关键词冷却（秒） */
  qaCooldownSeconds?: number;
  /** 问答同用户冷却（秒） */
  qaUserCooldownSeconds?: number;
  /** 问答低风险关键词冷却（秒） */
  qaTierCooldownLow?: number;
  /** 问答中风险关键词冷却（秒） */
  qaTierCooldownMedium?: number;
  /** 问答高风险关键词冷却（秒） */
  qaTierCooldownHigh?: number;
  /** 高风险关键词模式（命中即按高风险冷却） */
  qaHighRiskPatterns?: string[];
  /** 中风险关键词模式（命中即按中风险冷却） */
  qaMediumRiskPatterns?: string[];
  /** 同群触发熔断窗口（秒） */
  groupFuseWindowSeconds?: number;
  /** 同群触发熔断阈值（窗口内发送条数） */
  groupFuseThreshold?: number;
  /** 熔断持续时长（秒） */
  groupFuseCooldownSeconds?: number;
  /** 全局发送队列上限 */
  maxQueueSizeGlobal?: number;
  /** 分群发送队列上限 */
  maxQueueSizePerGroup?: number;
  // 新增开关
  /** 是否禁用问答 */
  disableQA?: boolean;
  /** 是否禁用签到 */
  disableSignin?: boolean;
  /** 是否禁用抽奖 */
  disableLottery?: boolean;
  /** 是否禁用邀请统计 */
  disableInvite?: boolean;
  /** 是否禁用活跃统计 */
  disableActivity?: boolean;

  // ===== 商用入群验证 =====
  /** 入群暗号（为空则关闭） */
  entryPassphrase?: string;
  /** 暗号关闭后是否回落到自动同意（默认开启） */
  enableAutoApproveAfterPassphraseOff?: boolean;
  /** 默认回复人格 */
  replyPersonaDefault?: ReplyPersona;
  /** 是否每次回复随机人格 */
  autoRandomPersona?: boolean;
  /** 场景人格覆盖 */
  replyPersonaByScene?: Record<string, ReplyPersona>;
  /** 场景模板库 */
  replySceneTemplates?: ReplySceneTemplateMap;
}

export type ReplyPersona = 'formal' | 'friendly' | 'strict' | 'humor' | 'professional' | 'gentle';

export interface ReplySceneTemplateEntry {
  personaTemplates?: Partial<Record<ReplyPersona, string[]>>;
}

export type ReplySceneTemplateMap = Record<string, ReplySceneTemplateEntry>;

/** 入群验证日志 */
export interface JoinLogEntry {
  groupId: string;
  userId: string;
  /** 匹配到的验证信息 */
  answer: string;
  /** 是否匹配暗号 */
  passphraseMatched: boolean;
  /** 执行动作：approve | reject */
  action: 'approve' | 'reject';
  /** 详情/理由 */
  reason: string;
  timestamp: number;
}

export interface ScheduledTask {
  id: string;
  cron: string; // 简化版: "HH:mm" 或 "interval:minutes"
  type: 'text' | 'image';
  content: string;
  lastRun?: number;
}

export interface SigninData {
  lastSigninTime: number; // timestamp
  streak: number; // 连续签到天数
  points: number; // 积分
}

export interface InviteData {
  inviterId: string; // 邀请人QQ
  inviteCount: number; // 邀请人数
  invitedUsers: string[]; // 被邀请人QQ列表
}

export interface GroupLicense {
  expireTime: number; // 授权过期时间戳，0表示永久
  level: 'free' | 'pro' | 'enterprise';
}

export interface VerifySession {
  userId: string;
  groupId: string;
  answer: number;
  expression: string;
  attempts: number;
  maxAttempts: number;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export interface ActivityRecord {
  msgCount: number;
  lastActive: number;
  todayCount: number;
  todayDate: string;
}

/** 问答条目 */
export interface QAEntry {
  /** 触发关键词 */
  keyword: string;
  /** 回复内容，支持 {user} {group} */
  reply: string;
  /** 匹配模式: exact=精确 contains=包含 regex=正则 */
  mode: 'exact' | 'contains' | 'regex';
}

/** 预设配置模板 */
export interface PresetConfig {
  /** 预设名称 */
  name: string;
  /** 保存的设置快照 */
  settings: GroupGuardSettings;
  /** 全局级别的字段快照 */
  globalFields?: {
    filterKeywords?: string[];
    filterPunishLevel?: number;
    filterBanMinutes?: number;
    blacklist?: string[];
    whitelist?: string[];
    leaveBlacklist?: boolean;
    spamDetect?: boolean;
    spamWindow?: number;
    spamThreshold?: number;
    spamBanMinutes?: number;
    msgFilter?: MsgFilterSettings;
    welcomeMessage?: string;
    qaList?: QAEntry[];
  };
}
