import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    proxy: {
      enabled: process.env.PROXY_ENABLED === "true",
      baseUrl: process.env.PROXY_BASE_URL ? "[configured]" : "[not set]",
      provider: process.env.PROXY_PROVIDER ?? "openai",
      timeout: parseInt(process.env.PROXY_TIMEOUT ?? "30000", 10),
      apiKeySet: Boolean(process.env.PROXY_API_KEY),
    },
  });
});

router.post("/config/validate", (req: Request, res: Response) => {
  const { baseUrl, provider } = req.body as { baseUrl?: string; provider?: string };
  const errors: string[] = [];

  if (!baseUrl) {
    errors.push("baseUrl is required");
  } else {
    try {
      new URL(baseUrl);
    } catch {
      errors.push("baseUrl must be a valid URL");
    }
  }

  const validProviders = ["openai", "anthropic", "ollama", "lmstudio", "custom"];
  if (provider && !validProviders.includes(provider)) {
    errors.push(`provider must be one of: ${validProviders.join(", ")}`);
  }

  if (errors.length > 0) {
    res.status(400).json({ valid: false, errors });
    return;
  }

  res.json({ valid: true, message: "Configuration looks valid" });
});

export default router;
