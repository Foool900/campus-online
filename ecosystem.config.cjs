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
      },
    },
  ],
};
