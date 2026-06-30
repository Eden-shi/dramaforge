import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CustomProviderInput } from "@dramaforge/shared";
import { ProviderRegistry } from "../providers/registry.js";
import { newId, type Repo } from "../store/repo.js";

const addCustomSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['llm', 'image', 'video', 'tts']),
  protocol: z.enum(['openai_compat', 'dashscope_async', 'kling_async', 'jimeng_async', 'minimax_async']),
  baseUrl: z.string().min(1),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export function customProviderRoutes(app: FastifyInstance, registry: ProviderRegistry, repo: Repo) {
  app.post("/api/providers/custom", async (req, reply) => {
    const body = addCustomSchema.parse(req.body) as CustomProviderInput;
    const info = registry.addCustom(body);
    repo.setProviders(registry.exportAll());
    await repo.flush();
    return info;
  });

  app.delete("/api/providers/custom/:id", async (req, reply) => {
    const id = (req.params as any).id;
    if (!registry.isCustom(id)) {
      return reply.code(404).send({ error: '找不到自定义供应商或不允许删除内置供应商' });
    }
    registry.removeCustom(id);
    repo.setProviders(registry.exportAll());
    await repo.flush();
    return { ok: true };
  });

  app.get("/api/providers/custom", async () => {
    return registry.list().filter((p) => p.custom);
  });
}