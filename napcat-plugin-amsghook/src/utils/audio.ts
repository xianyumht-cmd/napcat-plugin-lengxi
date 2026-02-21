// 音频转换：ffmpeg → PCM → silk_codec → silk（标准 silk，用于官方 bot API）
import { execFile } from 'child_process';
import { existsSync, readFileSync, unlinkSync, chmodSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { platform, arch } from 'os';
import { fileURLToPath } from 'url';
import { addLog } from '../core/logger';

const __pluginDir = dirname(fileURLToPath(import.meta.url));

/** 获取 silk_codec 二进制路径 */
function getSilkCodecPath (): string | null {
  const sys = platform();
  const machine = arch();
  let name: string | null = null;
  if (sys === 'win32') {
    name = (machine === 'x64' || machine === 'ia32') ? `silk_codec-windows-static-${machine === 'x64' ? 'x64' : 'x86'}.exe` : null;
  } else if (sys === 'linux') {
    name = machine === 'x64' ? 'silk_codec-linux-x64' : (machine === 'arm64' ? 'silk_codec-linux-arm64' : null);
  }
  if (!name) return null;
  // dist/index.mjs → 插件根目录/bin/
  const candidates = [
    join(__pluginDir, 'bin', name),        // dist/ 同级 bin/
    join(__pluginDir, '..', 'bin', name),   // 上一级 bin/
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  addLog('info', `silk_codec 未找到: 尝试路径 ${candidates.join(', ')}`);
  return null;
}

/** 执行命令行工具 */
function exec (cmd: string, args: string[], timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** 清理临时文件 */
function cleanup (...paths: (string | null)[]) {
  for (const p of paths) {
    if (p && existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * 将音频数据转换为标准 silk 格式（官方 bot API 可用）
 * 流程: 写入临时文件 → ffmpeg 转 PCM(24kHz mono s16le) → silk_codec 转 silk → 读取 silk
 * @param audioData 原始音频 Buffer
 * @returns silk 格式的 Buffer，失败返回 null
 */
export async function convertToSilk (audioData: Buffer): Promise<Buffer | null> {
  const codecPath = getSilkCodecPath();
  if (!codecPath) {
    addLog('info', 'silk_codec 二进制不存在，无法转换语音');
    return null;
  }
  // Linux 下确保可执行权限
  if (platform() !== 'win32') {
    try { chmodSync(codecPath, 0o755); } catch { /* ignore */ }
  }

  const tmp = tmpdir();
  const id = randomUUID();
  const audioPath = join(tmp, `${id}.audio`);
  const pcmPath = join(tmp, `${id}.pcm`);
  const silkPath = join(tmp, `${id}.silk`);

  try {
    await writeFile(audioPath, audioData);

    // 检查是否已经是标准 silk（以 #!SILK 开头）
    if (audioData.length > 6) {
      const header = audioData.subarray(0, 10).toString();
      if (header.includes('#!SILK')) {
        addLog('info', '音频已是标准 silk 格式，跳过转换');
        return audioData;
      }
    }

    // ffmpeg 转 PCM
    await exec('ffmpeg', ['-y', '-i', audioPath, '-ar', '24000', '-ac', '1', '-f', 's16le',
      '-loglevel', 'quiet', '-hide_banner', pcmPath]);

    if (!existsSync(pcmPath) || statSync(pcmPath).size === 0) {
      addLog('info', 'ffmpeg 转 PCM 失败');
      return null;
    }

    // silk_codec 转 silk
    await exec(codecPath, ['pts', '-i', pcmPath, '-o', silkPath, '-s', '24000']);

    if (!existsSync(silkPath) || statSync(silkPath).size === 0) {
      addLog('info', 'silk_codec 转换失败');
      return null;
    }

    const silkData = readFileSync(silkPath);
    addLog('info', `silk 转换成功: ${audioData.length} → ${silkData.length} bytes`);
    return silkData;
  } catch (e: any) {
    addLog('info', `silk 转换异常: ${e.message}`);
    return null;
  } finally {
    cleanup(audioPath, pcmPath, silkPath);
  }
}
