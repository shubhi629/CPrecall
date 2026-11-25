import { v4 as uuidv4 } from "uuid";
import {
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * In-Memory Problem Reference Catalog
 * Loaded on startup from DynamoDB to support instant, scan-free substring searches,
 * multi-dimensional filtering, and exact offset pagination across 4,000 reference questions.
 */
let memoryCatalog = [];
let catalogInitialized = false;
let patternSet = new Set();

export const problemRepo = {
  /**
   * Initialize or reload the in-memory catalog cache from DynamoDB
   */
  async initCatalog() {
    // Read all problems (Metadata items only)
    // Note: Querying/scanning once on startup populates the in-memory catalog for all subsequent client queries
    const difficulties = ["Easy", "Medium", "Hard"];
    const allProblems = [];
    const patterns = new Set();

    for (const diff of difficulties) {
      let lek = undefined;
      do {
        const res = await docClient.send(
          new QueryCommand({
            TableName: TABLES.PROBLEMS,
            IndexName: "DifficultyIndex",
            KeyConditionExpression: "difficulty = :d",
            ExpressionAttributeValues: { ":d": diff },
            ExclusiveStartKey: lek,
          })
        );
        if (res.Items) {
          for (const item of res.Items) {
            allProblems.push(item);
            if (Array.isArray(item.patterns)) {
              item.patterns.forEach((p) => patterns.add(p));
            }
          }
        }
        lek = res.LastEvaluatedKey;
      } while (lek);
    }

    memoryCatalog = allProblems;
    patternSet = patterns;
    catalogInitialized = true;
    return memoryCatalog.length;
  },

  /**
   * Get total number of active questions in the CPRecal problem library.
   */
  async getTotalProblemsCount() {
    if (memoryCatalog.length > 0) {
      return memoryCatalog.length;
    }
    await this.initCatalog();
    return memoryCatalog.length;
  },

  /**
   * Save or update a problem, keeping pattern adjacency items and unique pattern metadata in sync.
   */
  async createOrUpdateProblem(problemData) {
    const problemId = problemData._id?.toString() || problemData.problemId || uuidv4();
    const leetcodeId = parseInt(problemData.leetcodeId, 10);
    const title = (problemData.title || "").trim();
    const titleSlug = (problemData.titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).toLowerCase();
    const difficulty = problemData.difficulty || "Medium";
    const patterns = Array.isArray(problemData.patterns) ? problemData.patterns : [];
    const description = problemData.description || "";
    const now = new Date().toISOString();

    // 1. Problem Metadata Item
    const metadataItem = {
      PK: `PROBLEM#${problemId}`,
      SK: "META",
      problemId,
      _id: problemId,
      leetcodeId,
      title,
      titleSlug,
      difficulty,
      patterns,
      description,
      createdAt: problemData.createdAt || now,
      updatedAt: now,
    };

    // 2. Pattern Adjacency Items (1 per pattern)
    // NOTE: We specifically do NOT set top-level 'difficulty' or 'title' to prevent duplicate entries in DifficultyIndex!
    const adjacencyItems = patterns.map((p) => ({
      PK: `PATTERN#${p}`,
      SK: `PROBLEM#${problemId}`,
      patternGSI_PK: p,
      patternGSI_SK: `${difficulty}#${title}`,
      problemId,
      leetcodeId,
      problemTitle: title,
      problemDifficulty: difficulty,
      patterns,
      createdAt: now,
    }));

    // Transact write metadata + adjacency items
    const transactItems = [
      {
        Put: {
          TableName: TABLES.PROBLEMS,
          Item: metadataItem,
        },
      },
      ...adjacencyItems.map((item) => ({
        Put: {
          TableName: TABLES.PROBLEMS,
          Item: item,
        },
      })),
    ];

    // Also update global patterns metadata item
    patterns.forEach((p) => patternSet.add(p));
    transactItems.push({
      Put: {
        TableName: TABLES.PROBLEMS,
        Item: {
          PK: "METADATA",
          SK: "ALL_PATTERNS",
          uniquePatterns: Array.from(patternSet),
          updatedAt: now,
        },
      },
    });

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    // Update in-memory catalog
    const existingIndex = memoryCatalog.findIndex((p) => p.problemId === problemId);
    if (existingIndex >= 0) {
      memoryCatalog[existingIndex] = metadataItem;
    } else {
      memoryCatalog.push(metadataItem);
    }

    return metadataItem;
  },

  /**
   * Strongly consistent point lookup by problemId.
   */
  async getProblemById(problemId) {
    if (!problemId) return null;

    if (memoryCatalog.length > 0) {
      const pIdStr = problemId.toString();
      const cached = memoryCatalog.find((p) => (p.problemId || p._id).toString() === pIdStr);
      if (cached) return cached;
    }

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROBLEMS,
        Key: {
          PK: `PROBLEM#${problemId}`,
          SK: "META",
        },
        ConsistentRead: true,
      })
    );

    return res.Item || null;
  },

  /**
   * Lookup problem by LeetCode problem number via LeetcodeIdIndex.
   */
  async getProblemByLeetcodeId(leetcodeId) {
    const num = parseInt(leetcodeId, 10);
    if (isNaN(num)) return null;

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.PROBLEMS,
        IndexName: "LeetcodeIdIndex",
        KeyConditionExpression: "leetcodeId = :id",
        ExpressionAttributeValues: { ":id": num },
      })
    );

    return res.Items && res.Items.length > 0 ? res.Items[0] : null;
  },

  /**
   * Lookup problem by title slug via TitleSlugIndex.
   */
  async getProblemBySlug(titleSlug) {
    if (!titleSlug) return null;

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.PROBLEMS,
        IndexName: "TitleSlugIndex",
        KeyConditionExpression: "titleSlug = :slug",
        ExpressionAttributeValues: { ":slug": titleSlug.toLowerCase().trim() },
      })
    );

    return res.Items && res.Items.length > 0 ? res.Items[0] : null;
  },

  /**
   * Dual lookup by slug or title (used by /api/analyze).
   */
  async getProblemByTitleOrSlug(title, titleSlug) {
    if (titleSlug) {
      const bySlug = await this.getProblemBySlug(titleSlug);
      if (bySlug) return bySlug;
    }

    if (title) {
      const generatedSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const byGenSlug = await this.getProblemBySlug(generatedSlug);
      if (byGenSlug) return byGenSlug;

      // Fallback: search in-memory catalog
      const match = memoryCatalog.find((p) => p.title.toLowerCase() === title.toLowerCase().trim());
      if (match) return match;
    }

    return null;
  },

  /**
   * Query problems for a specific pattern using the PatternDifficultyIndex.
   * Supports instant difficulty filtering without scanning.
   */
  async getProblemsByPattern(patternName, { difficulty = null, limit = null } = {}) {
    if (!patternName) return [];

    if (memoryCatalog.length > 0) {
      let filtered = memoryCatalog.filter(
        (p) => Array.isArray(p.patterns) && p.patterns.includes(patternName)
      );
      if (difficulty) {
        filtered = filtered.filter((p) => p.difficulty === difficulty);
      }
      if (limit) {
        filtered = filtered.slice(0, limit);
      }
      return filtered.map((item) => ({
        ...item,
        title: item.problemTitle || item.title,
        difficulty: item.problemDifficulty || item.difficulty,
      }));
    }

    let keyCondition = "patternGSI_PK = :pat";
    const exprValues = { ":pat": patternName };

    if (difficulty) {
      keyCondition += " AND begins_with(patternGSI_SK, :diffPrefix)";
      exprValues[":diffPrefix"] = `${difficulty}#`;
    }

    const commandInput = {
      TableName: TABLES.PROBLEMS,
      IndexName: "PatternDifficultyIndex",
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: exprValues,
    };

    if (limit) {
      commandInput.Limit = limit;
    }

    const res = await docClient.send(new QueryCommand(commandInput));
    return (res.Items || []).map((item) => ({
      ...item,
      title: item.problemTitle || item.title,
      difficulty: item.problemDifficulty || item.difficulty,
    }));
  },

  /**
   * Query problems by difficulty using DifficultyIndex.
   */
  async getProblemsByDifficulty(difficulty, { limit = null } = {}) {
    if (!difficulty) return [];

    if (memoryCatalog.length > 0) {
      let filtered = memoryCatalog.filter((p) => p.difficulty === difficulty);
      if (limit) {
        filtered = filtered.slice(0, limit);
      }
      return filtered;
    }

    const commandInput = {
      TableName: TABLES.PROBLEMS,
      IndexName: "DifficultyIndex",
      KeyConditionExpression: "difficulty = :d",
      ExpressionAttributeValues: { ":d": difficulty },
    };

    if (limit) {
      commandInput.Limit = limit;
    }

    const res = await docClient.send(new QueryCommand(commandInput));
    return res.Items || [];
  },

  /**
   * Batch get multiple problems by IDs (up to 100 per DynamoDB request).
   */
  async batchGetProblems(problemIds) {
    if (!problemIds || problemIds.length === 0) return [];

    if (memoryCatalog.length > 0) {
      const idSet = new Set(problemIds.filter(Boolean).map((id) => id.toString()));
      return memoryCatalog.filter((p) => idSet.has((p.problemId || p._id).toString()));
    }

    const uniqueIds = Array.from(new Set(problemIds.filter(Boolean)));
    const results = [];
    const CHUNK_SIZE = 100;

    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
      const keys = chunk.map((id) => ({
        PK: `PROBLEM#${id}`,
        SK: "META",
      }));

      const res = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TABLES.PROBLEMS]: {
              Keys: keys,
            },
          },
        })
      );

      if (res.Responses && res.Responses[TABLES.PROBLEMS]) {
        results.push(...res.Responses[TABLES.PROBLEMS]);
      }
    }

    return results;
  },

  /**
   * Get all distinct pattern names across the library.
   */
  async getAllPatterns() {
    if (patternSet.size > 0) {
      return Array.from(patternSet);
    }

    if (memoryCatalog.length > 0) {
      for (const item of memoryCatalog) {
        if (Array.isArray(item.patterns)) {
          item.patterns.forEach((p) => patternSet.add(p));
        }
      }
      if (patternSet.size > 0) {
        return Array.from(patternSet);
      }
    }

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.PROBLEMS,
        Key: {
          PK: "METADATA",
          SK: "ALL_PATTERNS",
        },
      })
    );

    if (res.Item?.uniquePatterns) {
      const patterns = Array.isArray(res.Item.uniquePatterns)
        ? res.Item.uniquePatterns
        : Array.from(res.Item.uniquePatterns);
      patterns.forEach((p) => patternSet.add(p));
      return patterns;
    }

    return Array.from(patternSet);
  },

  /**
   * Supports ProblemLibrary pagination and multi-dimensional filtering
   * matching problemController.js contract completely without client changes.
   */
  async getProblemsPaginated({
    difficulty,
    pattern,
    status,
    search,
    limit = 20,
    offset = 0,
    solvedProblemIds = [],
    recallProblemIds = [],
  }) {
    // Use memory catalog if populated, otherwise query base tables
    let dataset = memoryCatalog.length > 0 ? [...memoryCatalog] : [];

    if (dataset.length === 0 && pattern) {
      dataset = await this.getProblemsByPattern(pattern);
    } else if (dataset.length === 0 && difficulty) {
      dataset = await this.getProblemsByDifficulty(difficulty);
    }

    const solvedSet = new Set((solvedProblemIds || []).map((id) => id.toString()));
    const recallSet = new Set((recallProblemIds || []).map((id) => id.toString()));

    let filtered = dataset.filter((p) => {
      // 1. Difficulty filter
      if (difficulty && difficulty !== "ALL" && p.difficulty !== difficulty) {
        return false;
      }

      // 2. Pattern filter
      if (pattern && pattern !== "ALL") {
        if (!Array.isArray(p.patterns) || !p.patterns.includes(pattern)) {
          return false;
        }
      }

      // 3. Search filter
      if (search && search.trim()) {
        const cleanSearch = search.replace(/^#/, "").trim().toLowerCase();
        const isNum = !isNaN(cleanSearch) && cleanSearch !== "";
        if (isNum) {
          const matchNum = p.leetcodeId === parseInt(cleanSearch, 10);
          const matchTitle = p.title.toLowerCase().includes(cleanSearch);
          if (!matchNum && !matchTitle) return false;
        } else {
          if (!p.title.toLowerCase().includes(cleanSearch)) return false;
        }
      }

      // 4. Status filter
      const pIdStr = p.problemId || p._id;
      if (status === "solved") {
        if (!solvedSet.has(pIdStr)) return false;
      } else if (status === "unsolved") {
        if (solvedSet.has(pIdStr)) return false;
      } else if (status === "recall" || status === "scheduled") {
        if (!recallSet.has(pIdStr)) return false;
      }

      return true;
    });

    const total = filtered.length;
    const pageItems = filtered.slice(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10));

    return {
      problems: pageItems,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };
  },

  /**
   * Bulk upsert problems in BatchWriteItem chunks of 25.
   * Used by LeetCode sync scripts and migration tools.
   */
  async bulkUpsertProblems(problemsArray) {
    if (!problemsArray || problemsArray.length === 0) return 0;

    let totalWritten = 0;
    const writeRequests = [];

    for (const p of problemsArray) {
      const problemId = p._id?.toString() || p.problemId || uuidv4();
      const leetcodeId = parseInt(p.leetcodeId, 10);
      const title = (p.title || "").trim();
      const titleSlug = (p.titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).toLowerCase();
      const difficulty = p.difficulty || "Medium";
      const patterns = Array.isArray(p.patterns) ? p.patterns : [];
      const description = p.description || "";
      const now = new Date().toISOString();

      // Metadata item
      const metaItem = {
        PK: `PROBLEM#${problemId}`,
        SK: "META",
        problemId,
        _id: problemId,
        leetcodeId,
        title,
        titleSlug,
        difficulty,
        patterns,
        description,
        createdAt: p.createdAt || now,
        updatedAt: now,
      };

      writeRequests.push({
        PutRequest: { Item: metaItem },
      });

      // Adjacency items
      patterns.forEach((pat) => {
        patternSet.add(pat);
        writeRequests.push({
          PutRequest: {
            Item: {
              PK: `PATTERN#${pat}`,
              SK: `PROBLEM#${problemId}`,
              patternGSI_PK: pat,
              patternGSI_SK: `${difficulty}#${title}`,
              problemId,
              leetcodeId,
              problemTitle: title,
              problemDifficulty: difficulty,
              patterns,
              createdAt: now,
            },
          },
        });
      });

      // Update in-memory
      memoryCatalog.push(metaItem);
    }

    // Chunk into batches of 25
    const CHUNK_SIZE = 25;
    for (let i = 0; i < writeRequests.length; i += CHUNK_SIZE) {
      const chunk = writeRequests.slice(i, i + CHUNK_SIZE);
      let attempts = 0;
      let unprocessed = { [TABLES.PROBLEMS]: chunk };

      while (unprocessed && Object.keys(unprocessed).length > 0 && attempts < 5) {
        const res = await docClient.send(
          new BatchWriteCommand({
            RequestItems: unprocessed,
          })
        );
        unprocessed = res.UnprocessedItems;
        if (unprocessed && Object.keys(unprocessed).length > 0) {
          attempts++;
          await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 50));
        }
      }
      totalWritten += chunk.length;
    }

    catalogInitialized = true;
    return totalWritten;
  },

  /**
   * Get total number of active questions in the CPRecal library catalog.
   * Auto-initializes from DynamoDB if memory catalog is cold.
   */
  async getTotalProblemsCount() {
    if (memoryCatalog.length > 0) {
      return memoryCatalog.length;
    }
    await this.initCatalog();
    if (memoryCatalog.length > 0) {
      return memoryCatalog.length;
    }
    try {
      const Problem = (await import("../models/Problem.js")).default;
      return await Problem.countDocuments();
    } catch {
      return 0;
    }
  },

  /**
   * Reset in-memory catalog (mainly for testing)
   */
  resetMemoryCatalog() {
    memoryCatalog = [];
    patternSet = new Set();
    catalogInitialized = false;
  },
};

export default problemRepo;
