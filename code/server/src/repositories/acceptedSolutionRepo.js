import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OVERFLOW_DIR = path.resolve(__dirname, "../../dynamo-data/s3-overflow");

const OVERFLOW_THRESHOLD_BYTES = 300 * 1024; // 300 KB

export const acceptedSolutionRepo = {
  /**
   * Save accepted solution. Uses S3 / disk claim-check overflow if size >= 300 KB.
   */
  async saveAcceptedSolution(userId, problemId, solutionData) {
    const now = new Date().toISOString();
    const pIdStr = problemId.toString();

    const payloadToMeasure = JSON.stringify({
      code: solutionData.code || "",
      analysisResult: solutionData.analysisResult || null,
    });
    const byteSize = Buffer.byteLength(payloadToMeasure, "utf8");

    let isOverflow = false;
    let s3Pointer = null;
    let storedCode = solutionData.code || "";
    let storedAnalysis = solutionData.analysisResult || null;

    if (byteSize >= OVERFLOW_THRESHOLD_BYTES) {
      isOverflow = true;
      if (!fs.existsSync(OVERFLOW_DIR)) {
        fs.mkdirSync(OVERFLOW_DIR, { recursive: true });
      }

      const overflowFileName = `${userId}_${pIdStr}.json`;
      const overflowFilePath = path.join(OVERFLOW_DIR, overflowFileName);

      fs.writeFileSync(
        overflowFilePath,
        JSON.stringify({
          code: solutionData.code,
          analysisResult: solutionData.analysisResult,
          userId,
          problemId: pIdStr,
          savedAt: now,
        }),
        "utf8"
      );

      s3Pointer = {
        key: `solutions/${userId}/${pIdStr}.json`,
        localPath: overflowFilePath,
        size: byteSize,
        isOverflow: true,
      };

      // Omit raw huge fields from DynamoDB item
      storedCode = "[OFFLOADED_TO_CLAIM_CHECK_STORAGE]";
      storedAnalysis = { isOverflow: true, pointerKey: s3Pointer.key };
    }

    const uIdStr = userId.toString();
    const item = {
      PK: `USER#${uIdStr}`,
      SK: `SOLUTION#${pIdStr}`,
      userId: uIdStr,
      problemId: pIdStr,
      submissionId: solutionData.submissionId?.toString() || null,
      code: storedCode,
      language: solutionData.language || "unknown",
      runtime: solutionData.runtime ?? null,
      memory: solutionData.memory ?? null,
      analysisResult: storedAnalysis,
      isOverflow,
      s3Pointer,
      solvedAt: solutionData.solvedAt || now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Item: item,
      })
    );

    return {
      ...item,
      code: solutionData.code,
      analysisResult: solutionData.analysisResult,
    };
  },

  /**
   * Transparently retrieve accepted solution.
   * If claim-check overflow was used, merges offloaded payload seamlessly.
   */
  async getAcceptedSolution(userId, problemId) {
    if (!userId || !problemId) return null;

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${userId}`,
          SK: `SOLUTION#${problemId.toString()}`,
        },
        ConsistentRead: true,
      })
    );

    const item = res.Item;
    if (!item) return null;

    // Handle transparent retrieval from overflow storage
    if (item.isOverflow && item.s3Pointer?.localPath) {
      try {
        if (fs.existsSync(item.s3Pointer.localPath)) {
          const raw = fs.readFileSync(item.s3Pointer.localPath, "utf8");
          const parsed = JSON.parse(raw);
          item.code = parsed.code;
          item.analysisResult = parsed.analysisResult;
        }
      } catch (err) {
        console.warn(`[AcceptedSolution] Failed to read overflow storage:`, err.message);
      }
    }

    return item;
  },
};

export default acceptedSolutionRepo;
