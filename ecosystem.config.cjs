// PM2 进程管理配置（服务器上使用）
// 用法：pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'campus-online',
      script: 'npm',
      args: 'start',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 80,
        // 知识库助手：本机 Ollama（默认监听 127.0.0.1:11434）
        OLLAMA_URL: 'http://127.0.0.1:11434',
        OLLAMA_CHAT_MODEL: 'qwen2.5:1.5b',
        OLLAMA_EMBED_MODEL: 'nomic-embed-text',
        // 云向量化（优先）：Key 不放这里，写入服务器 server/.env（git 忽略）
        EMBEDDING_BASE_URL: 'https://api.siliconflow.cn/v1',
        EMBEDDING_MODEL: 'BAAI/bge-m3',
      },
    },
  ],
};
