import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import configRouter from "./config";
import modelsRouter from "./models";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(configRouter);
router.use(modelsRouter);

export default router;
