import express from "express";
import {
  resetProgress,
  dismissCompletion,
} from "../controllers/progressController.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All progress routes strictly require authentication
router.use(requireAuth);

router.post("/reset", resetProgress);
router.post("/dismiss-completion", dismissCompletion);

export default router;
