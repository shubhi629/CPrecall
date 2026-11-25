import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import {
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";
import { normalizeEmail, validateUserRegistration } from "../utils/validation.js";

/**
 * User Repository — DynamoDB Implementation
 * Handles registration, atomic email reservation, authentication, and isolation.
 */
export const userRepo = {
  /**
   * Register a new user atomically with email reservation lock.
   * Throws 409 if email already exists (even under concurrent attempts).
   */
  async createUser({ name, email, password, passwordHash: preHashed, userId: explicitId }) {
    // Validate fields if plain password provided
    let cleanName = name;
    let cleanEmail = normalizeEmail(email);

    if (password) {
      const validated = validateUserRegistration({ name, email, password });
      cleanName = validated.name;
      cleanEmail = validated.email;
    }

    const userId = explicitId || uuidv4();
    const finalHash = preHashed || (await bcrypt.hash(password, 10));
    const now = new Date().toISOString();

    const userProfileItem = {
      PK: `USER#${userId}`,
      SK: "PROFILE",
      userId,
      name: cleanName,
      email: cleanEmail,
      passwordHash: finalHash,
      createdAt: now,
      updatedAt: now,
    };

    const emailReservationItem = {
      PK: `EMAIL#${cleanEmail}`,
      SK: "RESERVATION",
      userId,
      email: cleanEmail,
      createdAt: now,
    };

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLES.USERS,
                Item: userProfileItem,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: TABLES.USERS,
                Item: emailReservationItem,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        })
      );
    } catch (err) {
      if (
        err.name === "TransactionCanceledException" ||
        err.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed")
      ) {
        const error = new Error("An account with this email already exists.");
        error.status = 409;
        throw error;
      }
      throw err;
    }

    return {
      id: userId,
      _id: userId,
      name: cleanName,
      email: cleanEmail,
      createdAt: now,
    };
  },

  /**
   * Strongly consistent user lookup by authoritative email reservation.
   */
  async getUserByEmail(email, { includePassword = false } = {}) {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return null;

    // Step 1: Base-table point lookup for email reservation lock
    const reservationRes = await docClient.send(
      new GetCommand({
        TableName: TABLES.USERS,
        Key: {
          PK: `EMAIL#${cleanEmail}`,
          SK: "RESERVATION",
        },
        ConsistentRead: true,
      })
    );

    if (!reservationRes.Item) {
      return null;
    }

    const userId = reservationRes.Item.userId;

    // Step 2: Base-table point lookup for user profile
    const profileRes = await docClient.send(
      new GetCommand({
        TableName: TABLES.USERS,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
        ConsistentRead: true,
      })
    );

    const user = profileRes.Item;
    if (!user) return null;

    const result = {
      id: user.userId,
      _id: user.userId,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    if (includePassword) {
      result.passwordHash = user.passwordHash;
      result.comparePassword = async (candidate) => {
        return bcrypt.compare(candidate, user.passwordHash);
      };
    }

    return result;
  },

  /**
   * Strongly consistent lookup by userId.
   */
  async getUserById(userId) {
    if (!userId) return null;

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USERS,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
        ConsistentRead: true,
      })
    );

    const user = res.Item;
    if (!user) return null;

    return {
      id: user.userId,
      _id: user.userId,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  /**
   * Compare candidate password against stored bcrypt hash.
   */
  async verifyPassword(candidatePassword, passwordHash) {
    if (!candidatePassword || !passwordHash) return false;
    return bcrypt.compare(candidatePassword, passwordHash);
  },

  /**
   * Delete user and email reservation atomically.
   */
  async deleteUser(userId) {
    const user = await this.getUserById(userId);
    if (!user) return false;

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: TABLES.USERS,
              Key: { PK: `USER#${userId}`, SK: "PROFILE" },
            },
          },
          {
            Delete: {
              TableName: TABLES.USERS,
              Key: { PK: `EMAIL#${user.email}`, SK: "RESERVATION" },
            },
          },
        ],
      })
    );

    return true;
  },
};

export default userRepo;
