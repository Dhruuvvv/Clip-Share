import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clipsRouter from "./clips";
import storageRouter from "./storage";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clipsRouter);
router.use(storageRouter);
router.use(settingsRouter);

export default router;
