import mongoose from "mongoose";

const problemSchema = new mongoose.Schema(
  {
    leetcodeId: {
      type: Number,
      required: [true, "LeetCode problem ID is required"],
      unique: true,
    },
    title: {
      type: String,
      required: [true, "Problem title is required"],
    },
    titleSlug: {
      type: String,
      required: [true, "Problem slug is required"],
      unique: true,
      lowercase: true,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: [true, "Difficulty is required"],
    },
    patterns: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries (leetcodeId & titleSlug already indexed via unique:true)
problemSchema.index({ difficulty: 1 });
problemSchema.index({ patterns: 1 });

export const Problem = mongoose.model("Problem", problemSchema);
export default Problem;
