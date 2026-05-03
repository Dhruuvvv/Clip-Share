import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clipsRouter from "./clips";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clipsRouter);
router.use(storageRouter);

export default router;
