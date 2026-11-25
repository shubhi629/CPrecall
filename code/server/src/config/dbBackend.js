/**
 * CPRecal Database Backend Configuration & Abstraction Switch
 * 
 * Supports seamless switching between MongoDB (production safety baseline)
 * and AWS DynamoDB (high-performance target backend).
 * 
 * Set DB_BACKEND=dynamodb in .env to route traffic through DynamoDB repositories.
 * Defaults to 'mongodb' if unset, ensuring zero breaking changes.
 */

export const DB_BACKENDS = {
  MONGODB: "mongodb",
  DYNAMODB: "dynamodb",
};

export const getDBBackend = () => {
  return (process.env.DB_BACKEND || DB_BACKENDS.MONGODB).toLowerCase().trim();
};

export const isDynamoDB = () => {
  return getDBBackend() === DB_BACKENDS.DYNAMODB;
};

export const isMongoDB = () => {
  return getDBBackend() === DB_BACKENDS.MONGODB;
};

export const isDualWrite = () => {
  return (process.env.DUAL_WRITE || "false").toLowerCase().trim() === "true";
};

export default {
  DB_BACKENDS,
  getDBBackend,
  isDynamoDB,
  isMongoDB,
  isDualWrite,
};
