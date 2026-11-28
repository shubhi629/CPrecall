# CP Recall

## Adaptive Competitive Programming Pattern Retention System

CP Recall is a full-stack web application paired with a Tampermonkey browser extension
that helps competitive programmers build long-term retention of **DSA algorithmic
patterns**, not just individual problem solutions.

The system integrates directly into LeetCode. When a problem is solved, the extension
records the solving session, sends the accepted code to an AI model for complexity
analysis, computes a multi-component mastery score, and schedules a future review
using a simplified FSRS-inspired scheduler — critically, the review surfaces a
**different, unsolved problem** from the same algorithmic pattern family, testing
genuine conceptual transfer rather than memorisation.

---

## The Core Insight

Most competitive programming platforms track *how many* problems a user has solved.
CP Recall tracks *how well* the user has retained the **pattern** behind each problem.

> A user who solved a Sliding Window problem three weeks ago and cannot recognise a new
> Sliding Window problem has not retained the concept. CP Recall detects and corrects this.

---

## How the System Works

1. **Extension detects** when a problem is accepted on LeetCode
2. **LLM analyses** the accepted code for time and space complexity using Gemini 2.0 Flash
3. **Mastery is computed** from 5 dimensions: solution efficiency, time complexity,
   submission count, time taken, and hints used
4. **FSRS schedules** the next review interval based on the mastery score
5. **Dashboard surfaces** a different, unsolved problem from the same weak pattern when
   the review interval matures
6. **Marking a recall as done** extends the FSRS interval; failing resets it

---

## Project Team

**Team Nexus 3** — Thapar Institute of Engineering and Technology

| Member | Roll No. *(pending final team confirmation)* |
|---|---|
| Subham Kumar | 1024030665 |
| Tanush Grover | 1024030666 |
| Shubhi Singh | 1024030669 |

Submitted as part of **UCS503: Software Engineering** (2026–27, Odd Semester).
