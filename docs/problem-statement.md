# Problem Statement

## The Problem

Competitive programmers and students preparing for technical interviews face a
consistent challenge: they solve large numbers of problems but fail to retain the
**underlying algorithmic patterns** weeks or months later.

This manifests in three ways:

- A student solves a Sliding Window problem today but cannot recognise a new
  Sliding Window problem during an interview three weeks later
- A student has solved 300 LeetCode problems but still fails medium-difficulty
  problems because pattern recognition has not been internalised
- A student correctly solves a problem but does not know *why* a particular
  approach worked, making it impossible to apply the technique to a variant

## Motivation and Design Gaps Addressed

CP Recall was designed to address specific workflow gaps observed when practicing
algorithmic problems across separate tools:

### Practice Platforms (e.g. LeetCode)
Standard coding platforms focus primarily on acceptance status and problem counts.
CP Recall's design objective is to add a layer that tracks **how efficiently** a
problem was solved, aggregates performance by **algorithmic pattern**, and prompts
timed reviews of weak patterns.

### General-Purpose Spaced Repetition (e.g. Anki)
Flashcard-based spaced repetition tools are typically built around manually authored
cards and self-graded recall. CP Recall is designed to integrate directly into the
coding workflow, compute ratings from objective session metrics (complexity, attempts,
time, and hints), and recommend a fresh problem rather than repeating the same prompt.

### Manual Notes and Spreadsheets
Tracking solved problems in spreadsheets requires manual upkeep and does not automate
review scheduling or pattern-level weakness detection. CP Recall automates session
capture and computes pattern aggregates directly from submitted solutions.

## Proposed Solution

CP Recall creates a **pattern-level memory layer** over a user's LeetCode activity.

Instead of tracking raw problem counts, it:

1. Associates each solved problem with its algorithmic pattern(s)
2. Measures how well the solution demonstrates mastery of that pattern
3. Uses a simplified FSRS-inspired spaced-repetition scheduler to schedule reviews
   at adaptive intervals
4. When a review is due, presents a **different, unsolved problem** from the same pattern
   family — testing pattern transfer on a problem the user has not yet solved,
   rather than repeating the original problem

## Objectives

- Automatically capture problem-solving sessions, code, and submission attempts from LeetCode (with only optional manual hint count input)
- Compute a nuanced mastery score from multiple performance dimensions
- Schedule pattern-level reviews using FSRS spaced repetition
- Surface the right problem at the right time to maximise long-term retention
- Provide a dashboard that makes the user's pattern-level weaknesses immediately visible
- Support multiple users with fully isolated progress tracking
