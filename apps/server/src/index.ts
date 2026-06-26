import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 7800);
const HOST = process.env.HOST ?? '127.0.0.1';

buildServer()
  .then((app) => app.listen({ port: PORT, host: HOST }))
  .then((addr) => {
    console.log(`\n  DramaForge 后端已启动: ${addr}\n`);
  })
  .catch((e) => {
    console.error('启动失败:', e);
    process.exit(1);
  });
