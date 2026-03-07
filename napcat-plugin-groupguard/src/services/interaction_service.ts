import { pluginState } from '../state';
import { authManager } from '../auth';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { getTarget, isAdminOrOwner, saveConfig, sendGroupScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';

export async function executeInteractionCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, raw, ctx } = input;
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;

  if (text === '签到') {
    if (pluginState.getGroupSettings(groupId).disableSignin) { await sendGroupScene(groupId, 'feature_disabled', '本群签到功能已关闭'); return true; }
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (userSignin.lastSignin >= today) {
      await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ' 你今天已经签到过了，明天再来吧！' } }
      ], { scene: 'raw_text', vars: { user: userId } });
      return true;
    }
    const yesterday = today - 86400000;
    if (userSignin.lastSignin >= yesterday && userSignin.lastSignin < today) userSignin.days++;
    else userSignin.days = 1;
    const settings = pluginState.getGroupSettings(groupId);
    const min = settings.signinMin || 10;
    const max = settings.signinMax || 50;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    const bonus = Math.min(userSignin.days, 10);
    const points = base + bonus;
    userSignin.points += points;
    userSignin.lastSignin = Date.now();
    await groupguardRepository.updateSignin(groupId, userId, userSignin);
    await pluginState.sendGroupMsg(groupId, [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 签到成功！\n获得积分：${points}\n当前积分：${userSignin.points}\n连续签到：${userSignin.days}天` } }
    ], { scene: 'signin_success', vars: { points, total: userSignin.points, days: userSignin.days } });
    return true;
  }
  if (text === '签到榜') {
    const data = await groupguardRepository.getAllSignin(groupId);
    if (!Object.keys(data).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无签到数据'); return true; }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const list = Object.entries(data).filter(([_, v]) => v.lastSignin >= today).sort((a, b) => b[1].lastSignin - a[1].lastSignin).slice(0, 10);
    if (!list.length) { await sendGroupScene(groupId, 'list_empty', '今天还没有人签到哦'); return true; }
    const content = list.map((item, i) => `${i + 1}. ${item[0]} (${new Date(item[1].lastSignin).toLocaleTimeString()})`).join('\n');
    await sendGroupScene(groupId, 'raw_text', `📅 今日签到榜\n${content}`);
    return true;
  }
  if (text === '我的积分') {
    const data = await groupguardRepository.getSignin(groupId, userId);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你的当前积分：${data ? data.points : 0}` } }], { scene: 'raw_text', vars: { user: userId } });
    return true;
  }
  if (text.startsWith('查封号')) {
    const rest = text.slice(3).trim();
    let targetQQ = rest;
    if (!targetQQ || !/^\d+$/.test(targetQQ)) targetQQ = getTarget(raw, rest) || '';
    if (!targetQQ) {
      await sendGroupScene(groupId, 'command_format_error', '请指定要查询的QQ号，例如：查封号 12345 或 查封号 @某人', { example: '查封号 123456789' });
      return true;
    }
    if (!/^\d{5,13}$/.test(targetQQ)) {
      await sendGroupScene(groupId, 'invalid_range', 'QQ号格式错误 (需5-13位数字)');
      return true;
    }
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    const banTexts = ['真是活该，直接进小黑屋了~', '这波操作属实离谱，封得明明白白。', '翻车现场，系统都看不下去了。', '号子已经躺平，连申诉都得排队。', '风控一锤定音，这把寄得很彻底。', '这号现在主打一个“只能看不能玩”。'];
    const safeTexts = ['安全着呢，稳得一批~', '状态健康，今天也没翻车。', '干净得很，风控都点了个赞。', '目前稳如老狗，继续保持。', '状态在线，暂时没有危险信号。', '看起来很平安，继续低调上分吧。'];
    const unknownTexts = ['接口今天有点小情绪，稍后再查一次。', '这波网络不太给面子，过会儿再试试。', '数据源在摸鱼，建议晚点重试。', '查询通道有点拥挤，等等会更稳。'];
    const sendResult = async (content: string) => {
      await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ` 查询的 QQ:${targetQQ}，${content}` } }
      ], { scene: 'raw_text', vars: { user: userId, target: targetQQ } });
    };
    try {
      const apiUrl = `https://yun.4png.com/api/query.html?token=c7739372694acf36&qq=${targetQQ}`;
      const response = await fetch(apiUrl);
      const data = await response.json() as any;
      const detailText = [data.msg, data.data?.banmsg, data.data?.time, data.data?.ban_time, data.data?.unban_time, data.data?.left_time]
        .filter((v: any) => typeof v === 'string' && v.trim())
        .join('；');
      if (data.code === 200) {
        const statusText = `${data.msg || ''} ${data.data?.banmsg || ''}`;
        const normalized = statusText.replace(/\s+/g, '');
        const unbanned = /未封|正常|安全|无封|未被封|无处罚/.test(normalized);
        const banned = /封|ban|冻结|停封|处罚|禁赛/.test(normalized) && !unbanned;
        if (banned) await sendResult(`这号被封了，详情：${detailText || '接口未返回更多时间信息'}，${pick(banTexts)}`);
        else await sendResult(`这号未封，详情：${detailText || '接口未返回更多时间信息'}，${pick(safeTexts)}`);
      } else if (data.code === 404) {
        await sendResult(`这号未封，详情：${detailText || '暂未查到封禁记录'}，${pick(safeTexts)}`);
      } else if (data.code === 403) {
        await sendResult(`暂时无法确认是否封号（403），详情：${detailText || '请求被拒绝'}，${pick(unknownTexts)}`);
      } else if (data.code === 429) {
        await sendResult(`暂时无法确认是否封号（429），详情：${detailText || '请求过于频繁或额度受限'}，${pick(unknownTexts)}`);
      } else {
        await sendResult(`暂时无法确认是否封号（${data.code || '未知状态'}），详情：${detailText || '接口返回异常'}，${pick(unknownTexts)}`);
      }
    } catch (e) {
      pluginState.log('error', `查询封号失败: ${e}`);
      await sendResult(`暂时无法确认是否封号，${pick(unknownTexts)}`);
    }
    return true;
  }
  if (text.startsWith('设置lolurl')) {
    if (!pluginState.isOwner(userId)) return true;
    const url = text.replace('设置lolurl', '').trim();
    if (!url) {
      await sendGroupScene(groupId, 'command_format_error', '请提供完整的查询接口地址，例如：设置lolurl http://example.com/query.php', { example: '设置lolurl http://example.com/query.php' });
      return true;
    }
    pluginState.config.lolQueryUrl = url;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '自定义战绩查询接口地址已更新');
    return true;
  }
  if (text.startsWith('设置lolkey')) {
    if (!pluginState.isOwner(userId)) return true;
    const key = text.replace('设置lolkey', '').trim();
    if (!key) {
      await sendGroupScene(groupId, 'command_format_error', '请提供授权码(zhanjikey)', { example: '设置lolkey demo-key' });
      return true;
    }
    pluginState.config.lolAuthKey = key;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '自定义战绩查询授权码已更新');
    return true;
  }
  if (text.startsWith('设置loltoken')) {
    if (!pluginState.isOwner(userId)) return true;
    const token = text.replace('设置loltoken', '').trim();
    if (!token) {
      await sendGroupScene(groupId, 'command_format_error', '请提供 Token，例如：设置loltoken eyJ...', { example: '设置loltoken eyJ...' });
      return true;
    }
    pluginState.config.lolToken = token;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', 'LOL Token 已更新');
    return true;
  }
  if (text.startsWith('查隐藏')) {
    const rest = text.replace('查隐藏', '').trim();
    if (!rest) {
      await sendGroupScene(groupId, 'command_format_error', '请指定召唤师名称，例如：查隐藏 TheShy', { example: '查隐藏 TheShy 1' });
      return true;
    }
    const args = rest.split(/\s+/);
    const name = args[0];
    const region = args[1] || '1';
    const customUrl = pluginState.config.lolQueryUrl;
    const customKey = pluginState.config.lolAuthKey;
    if (customUrl && customKey) {
      await sendGroupScene(groupId, 'raw_text', `🔍 正在通过自定义接口查询 ${name}...`);
      try {
        const params = new URLSearchParams();
        params.append('name', name);
        params.append('region', region);
        params.append('sign', '0');
        params.append('key', customKey);
        const res = await fetch(customUrl, {
          method: 'POST',
          body: params,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: `zhanjikey=${customKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (res.status === 200) {
          const json = await res.json() as any;
          if (json.status === 200) {
            const d = json.data;
            let msg = `📊 ${d.summonerName} (Lv.${d.level}) 隐藏战绩\n`;
            msg += `------------------------------\n`;
            msg += `封号状态: ${d.banstatus === 1 ? '❌ 封号' : (d.banstatus === 2 ? '❓ 未知/灰白' : '✅ 正常')}\n`;
            if (d.banst) msg += `封号详情: ${d.banst}\n`;
            msg += `单双排: ${d.soloData?.tier} ${d.soloData?.rank} (${d.soloData?.lp}点)\n`;
            msg += `灵活排: ${d.flexData?.tier} ${d.flexData?.rank} (${d.flexData?.lp}点)\n`;
            msg += `最后在线: ${d.last_game?.time || '未知'}\n`;
            msg += `排位资格: ${d.rankEligibility || '未知'}`;
            await sendGroupScene(groupId, 'raw_text', msg);
            return true;
          }
          await sendGroupScene(groupId, 'raw_text', `查询失败: ${json.msg || '未知错误'}`);
          return true;
        }
        await sendGroupScene(groupId, 'raw_text', `接口请求失败: HTTP ${res.status}`);
        return true;
      } catch (e: any) {
        pluginState.log('error', `自定义查询出错: ${e}`);
        await sendGroupScene(groupId, 'raw_text', `查询出错: ${e.message}`);
        return true;
      }
    }
    const token = pluginState.config.lolToken;
    if (!token) {
      await sendGroupScene(groupId, 'not_found', '❌ 未配置 LOL Token，请联系机器人主人配置');
      return true;
    }
    await sendGroupScene(groupId, 'raw_text', `🔍 正在查询 [${region}区] ${name} 的隐藏战绩...`);
    try {
      const searchRes = await fetch('https://ww1.lolso1.com/game-lol/customize-summoner-basic-by-name-region', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/json',
          Referer: 'https://lolso1.com/',
          Origin: 'https://lolso1.com'
        },
        body: JSON.stringify({ name, region: parseInt(region) || 1 })
      });
      const searchJson = await searchRes.json() as any;
      const summary = searchJson?.data?.summonerBasic;
      if (!summary?.puuid) {
        await sendGroupScene(groupId, 'not_found', `未找到召唤师：${name}`);
        return true;
      }
      const detailRes = await fetch(`https://ww1.lolso1.com/game-lol/customize-career-collection?region=${parseInt(region) || 1}&puuid=${summary.puuid}&name=${encodeURIComponent(name)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://lolso1.com/',
          Origin: 'https://lolso1.com'
        }
      });
      const detailJson = await detailRes.json() as any;
      const d = detailJson?.data?.[0] || detailJson?.data || {};
      const line = `📊 ${summary.name || name} (Lv.${summary.level || '?'})\n大区：${region}\n封号状态：${d.banstatus === 1 ? '❌ 封号' : '✅ 正常'}\n单双排：${d?.soloData?.tier || '-'} ${d?.soloData?.rank || ''} (${d?.soloData?.lp || 0}点)\n灵活排：${d?.flexData?.tier || '-'} ${d?.flexData?.rank || ''} (${d?.flexData?.lp || 0}点)\n最后在线：${d?.last_game?.time || '未知'}`;
      await sendGroupScene(groupId, 'raw_text', line);
      return true;
    } catch (e: any) {
      pluginState.log('error', `LOL查询失败: ${e}`);
      await sendGroupScene(groupId, 'raw_text', `查询失败：${e.message || e}`);
      return true;
    }
  }
  if (text === '邀请查询') {
    const data = await groupguardRepository.getInvite(groupId, userId);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你已邀请 ${data ? data.inviteCount : 0} 人加入本群` } }], { scene: 'raw_text', vars: { user: userId } });
    return true;
  }
  if (text === '邀请榜') {
    const data = await groupguardRepository.getAllInvites(groupId);
    if (!Object.keys(data).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无邀请数据'); return true; }
    const list = Object.entries(data).sort((a, b) => b[1].inviteCount - a[1].inviteCount).slice(0, 10);
    await sendGroupScene(groupId, 'raw_text', `🏆 邀请排行榜\n${list.map((item, i) => `${i + 1}. ${item[0]} - 邀请 ${item[1].inviteCount} 人`).join('\n')}`);
    return true;
  }
  if (text === '抽奖') {
    if (pluginState.getGroupSettings(groupId).disableLottery) { await sendGroupScene(groupId, 'feature_disabled', '本群抽奖功能已关闭'); return true; }
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    const settings = pluginState.getGroupSettings(groupId);
    const cost = settings.lotteryCost || 20;
    const maxReward = settings.lotteryReward || 100;
    if (!userSignin || userSignin.points < cost) {
      await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 积分不足！抽奖需要${cost}积分，请先签到获取积分。` } }], { scene: 'raw_text', vars: { user: userId } });
      return true;
    }
    userSignin.points -= cost;
    const rand = Math.random();
    let prize = '';
    let bonus = 0;
    if (rand < 0.01) { prize = `特等奖：积分+${maxReward}`; bonus = maxReward; }
    else if (rand < 0.1) { prize = `一等奖：积分+${Math.floor(maxReward * 0.5)}`; bonus = Math.floor(maxReward * 0.5); }
    else if (rand < 0.3) { prize = `二等奖：积分+${Math.floor(maxReward * 0.3)}`; bonus = Math.floor(maxReward * 0.3); }
    else if (rand < 0.6) { prize = `三等奖：积分+${Math.floor(maxReward * 0.1)}`; bonus = Math.floor(maxReward * 0.1); }
    else { prize = '谢谢参与'; bonus = 0; }
    userSignin.points += bonus;
    await groupguardRepository.updateSignin(groupId, userId, userSignin);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 消耗${cost}积分抽奖...\n🎉 ${prize}\n当前积分：${userSignin.points}` } }], { scene: 'raw_text', vars: { user: userId } });
    return true;
  }
  if (text.startsWith('兑换 ')) {
    if (pluginState.getGroupSettings(groupId).disableLottery) return true;
    const args = text.slice(3).trim().split(/\s+/);
    const item = args[0];
    const param = args.slice(1).join(' ');
    let userSignin = await groupguardRepository.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    if (item === '免死金牌') {
      const cost = 100;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      const warnings = await groupguardRepository.getWarning(groupId, userId);
      if (warnings <= 0) { await sendGroupScene(groupId, 'not_found', '你当前没有警告记录，无需使用免死金牌'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.runInTransaction(() => { groupguardRepository.updateSignin(groupId, userId, userSignin!); groupguardRepository.setWarning(groupId, userId, 0); });
      await sendGroupScene(groupId, 'action_success', `兑换成功！已清除所有警告记录。\n剩余积分：${userSignin.points}`, { user: userId });
      return true;
    }
    if (item === '头衔') {
      const cost = 500;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      if (!param) { await sendGroupScene(groupId, 'command_format_error', '请指定头衔内容：兑换 头衔 <内容>', { example: '兑换 头衔 传奇守护者' }); return true; }
      if (!await pluginState.isBotAdmin(groupId)) { await sendGroupScene(groupId, 'permission_denied', '兑换失败：机器人非管理员，无法设置头衔'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.updateSignin(groupId, userId, userSignin);
      await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: userId, special_title: param });
      await sendGroupScene(groupId, 'action_success', `兑换成功！头衔已设置为：${param}\n剩余积分：${userSignin.points}`, { user: userId });
      return true;
    }
    if (item === '解禁') {
      const cost = 200;
      const target = getTarget(raw, param) || userId;
      if (userSignin.points < cost) { await sendGroupScene(groupId, 'invalid_range', `积分不足，需要 ${cost} 积分`); return true; }
      if (!await pluginState.isBotAdmin(groupId)) { await sendGroupScene(groupId, 'permission_denied', '机器人非管理员'); return true; }
      userSignin.points -= cost;
      await groupguardRepository.updateSignin(groupId, userId, userSignin);
      await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: 0 });
      await sendGroupScene(groupId, 'action_success', `兑换成功！已解除 ${target} 的禁言。\n剩余积分：${userSignin.points}`, { user: userId, target });
      return true;
    }
    await sendGroupScene(groupId, 'not_found', '未知商品。请发送“积分商城”查看列表。');
    return true;
  }
  if (text === '积分商城' || text === '商城') {
    if (pluginState.getGroupSettings(groupId).disableLottery) { await sendGroupScene(groupId, 'feature_disabled', '本群积分功能已关闭'); return true; }
    await sendGroupScene(groupId, 'raw_text', `🛒 积分商城
----------------
1. 免死金牌 (清除警告) - 100积分
   指令：兑换 免死金牌
2. 自定义头衔 (永久) - 500积分
   指令：兑换 头衔 <内容>
3. 解除禁言 (自己) - 200积分
   指令：兑换 解禁
----------------
发送“我的积分”查看余额`);
    return true;
  }
  if (text.startsWith('开启发言奖励 ') || text === '关闭发言奖励') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (text === '关闭发言奖励') pluginState.config.groups[groupId].messageReward = 0;
    else {
      const points = parseInt(text.slice(7));
      if (isNaN(points) || points <= 0) { await sendGroupScene(groupId, 'command_format_error', '请输入正确的积分数', { example: '开启发言奖励 2' }); return true; }
      pluginState.config.groups[groupId].messageReward = points;
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '关闭发言奖励' ? '已关闭发言奖励' : `已开启发言奖励，每条消息奖励 ${pluginState.config.groups[groupId].messageReward} 积分`);
    return true;
  }
  if (text.startsWith('活跃统计')) {
    if (pluginState.getGroupSettings(groupId).disableActivity) { await sendGroupScene(groupId, 'feature_disabled', '本群活跃统计已关闭'); return true; }
    const stats = await groupguardRepository.getAllActivity(groupId);
    if (!Object.keys(stats).length) { await sendGroupScene(groupId, 'list_empty', '本群暂无活跃统计数据'); return true; }
    const selfId = String((event as any).self_id || '');
    const entries = Object.entries(stats).sort((a, b) => b[1].msgCount - a[1].msgCount);
    const today = new Date().toISOString().slice(0, 10);
    const totalMsg = entries.reduce((s, [, r]) => s + r.msgCount, 0);
    const todayMsg = entries.reduce((s, [, r]) => s + (r.lastActiveDay === today ? r.msgCountToday : 0), 0);
    const summary = `📊 本群活跃统计\n总消息数：${totalMsg}\n今日消息：${todayMsg}\n统计人数：${entries.length}`;
    const pages: string[] = [];
    const pageSize = 15;
    for (let i = 0; i < entries.length; i += pageSize) {
      const chunk = entries.slice(i, i + pageSize);
      pages.push(`排行榜（${i + 1}-${i + chunk.length}）\n\n${chunk.map(([uid, r], idx) => `${i + idx + 1}. ${uid}\n   总消息：${r.msgCount} | 今日：${r.lastActiveDay === today ? r.msgCountToday : 0}\n   最后活跃：${new Date(r.lastActive).toLocaleString('zh-CN', { hour12: false })}`).join('\n\n')}`);
    }
    const nodes = [summary, ...pages].map(content => ({ type: 'node', data: { nickname: '📊 活跃统计', user_id: selfId, content: [{ type: 'text', data: { text: content } }] } }));
    await pluginState.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
    return true;
  }
  return false;
}
