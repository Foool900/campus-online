// 向量化（embedding）：优先走云接口（OpenAI 兼容 /embeddings），否则回退本地 Ollama。
// 云接口配置优先从 process.env 读取，其次从 server/.env 文件读取（避免把 Key 提交进 git）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTexts as ollamaEmbed } from './ollama.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

function readEnvFile() {
  const env = {};
  try {
    const content = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* 无 .env 则忽略 */
  }
  return env;
}

const envFile = readEnvFile();

export const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || envFile.EMBEDDING_BASE_URL || '';
export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || envFile.EMBEDDING_API_KEY || '';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || envFile.EMBEDDING_MODEL || 'BAAI/bge-m3';

export function hasCloudEmbedding() {
  return !!(EMBEDDING_BASE_URL && EMBEDDING_API_KEY && EMBEDDING_MODEL);
}

async function cloudEmbed(texts) {
  try {
    const url = EMBEDDING_BASE_URL.replace(/\/+$/, '') + '/embeddings';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBEDDING_API_KEY}` },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const embeds = data?.data?.map((d) => d.embedding);
      return embeds && embeds.length === texts.length ? embeds : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// 对外：向量化（云优先，失败回退本地 Ollama）
export async function embedAll(texts) {
  if (hasCloudEmbedding()) {
    const r = await cloudEmbed(texts);
    if (r) return r;
  }
  return ollamaEmbed(texts);
}
