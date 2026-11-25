import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Problem from "../src/models/Problem.js";
import problemRepo from "../src/repositories/problemRepo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const isDynamoOnly = args.includes("--dynamo-only");
const isDynamo = args.includes("--dynamo") || args.includes("--both") || isDynamoOnly;

const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";

// Map LeetCode topic slugs to our standardized patterns where applicable
const patternMapping = {
  "dynamic-programming": "Dynamic Programming",
  "array": "Arrays & Hashing",
  "hash-table": "Arrays & Hashing",
  "string": "Arrays & Hashing", // Simplification, can be refined
  "two-pointers": "Two Pointers",
  "sliding-window": "Sliding Window",
  "stack": "Stack",
  "binary-search": "Binary Search",
  "linked-list": "Linked List",
  "tree": "Trees",
  "binary-tree": "Trees",
  "binary-search-tree": "Trees",
  "trie": "Tries",
  "heap-priority-queue": "Heap / Priority Queue",
  "backtracking": "Backtracking",
  "graph": "Graphs",
  "breadth-first-search": "Graphs",
  "depth-first-search": "Graphs",
  "topological-sort": "Advanced Graphs",
  "shortest-path": "Advanced Graphs",
  "minimum-spanning-tree": "Advanced Graphs",
  "greedy": "Greedy",
  "math": "Math & Geometry",
  "geometry": "Math & Geometry",
  "bit-manipulation": "Bit Manipulation",
  "matrix": "2D DP" // Partial mapping, can be refined
};

async function fetchLeetCodeProblems(limit = 100, skip = 0) {
  const query = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        total: totalNum
        questions: data {
          frontendQuestionId: questionFrontendId
          title
          titleSlug
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    }
  `;

  const variables = {
    categorySlug: "",
    skip,
    limit,
    filters: {}
  };

  const response = await fetch(LEETCODE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.problemsetQuestionList;
}

async function syncProblems() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    let skip = 0;
    const limit = 100;
    let totalSynced = 0;
    let totalAvailable = Infinity;

    console.log("Starting LeetCode problem sync...");

    while (skip < totalAvailable) {
      console.log(`Fetching problems ${skip} to ${skip + limit}...`);
      const result = await fetchLeetCodeProblems(limit, skip);
      
      if (totalAvailable === Infinity) {
        totalAvailable = result.total;
        console.log(`Total problems available on LeetCode: ${totalAvailable}`);
      }

      const questions = result.questions;
      if (!questions || questions.length === 0) break;

      const parsedQuestions = questions.map(q => {
        const mappedPatterns = new Set();
        if (q.topicTags) {
          q.topicTags.forEach(tag => {
            if (patternMapping[tag.slug]) {
              mappedPatterns.add(patternMapping[tag.slug]);
            } else {
              mappedPatterns.add(tag.name);
            }
          });
        }

        return {
          leetcodeId: parseInt(q.frontendQuestionId, 10),
          title: q.title,
          titleSlug: q.titleSlug,
          difficulty: q.difficulty,
          patterns: Array.from(mappedPatterns),
        };
      });

      // 1. Sync to MongoDB (if not dynamo-only)
      if (!isDynamoOnly) {
        const bulkOps = parsedQuestions.map(p => ({
          updateOne: {
            filter: { leetcodeId: p.leetcodeId },
            update: { $set: p },
            upsert: true,
          },
        }));

        if (bulkOps.length > 0) {
          await Problem.bulkWrite(bulkOps);
        }
      }

      // 2. Sync to DynamoDB (if dynamo or dual sync)
      if (isDynamo || isDynamoOnly) {
        await problemRepo.bulkUpsertProblems(parsedQuestions);
      }

      totalSynced += parsedQuestions.length;
      console.log(`Upserted ${parsedQuestions.length} problems. Total synced: ${totalSynced}`);

      skip += limit;
      
      // Sleep for a short time to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ Sync complete! Successfully synchronized ${totalSynced} problems.`);
  } catch (error) {
    console.error("Error syncing problems:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

// Run the script
syncProblems();
