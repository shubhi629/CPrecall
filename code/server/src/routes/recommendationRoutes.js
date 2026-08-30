import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getRecommendations } from "../controllers/recommendationController.js";

const router = express.Router();

router.get("/", requireAuth, getRecommendations);

export default router;
