import userRepo from "../src/repositories/userRepo.js";
import { initTables } from "./initLocalDynamo.js";

async function runUserRepoTests() {
  console.log("=================================================");
  console.log("CPRecal — Group 1: User Repository Test Suite");
  console.log("=================================================\n");

  // Ensure tables exist
  await initTables();

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
    }
  }

  const baseEmail = `testuser_${Date.now()}@example.com`;
  let createdUser = null;

  // Test 1: Successful Registration
  await test("User registration with valid fields", async () => {
    createdUser = await userRepo.createUser({
      name: "Alice Walker",
      email: baseEmail,
      password: "securePassword123",
    });

    if (!createdUser.id || createdUser.email !== baseEmail.toLowerCase()) {
      throw new Error("Created user does not have expected id or email");
    }
  });

  // Test 2: Duplicate Registration Rejection
  await test("Duplicate email registration is rejected with 409", async () => {
    try {
      await userRepo.createUser({
        name: "Alice Imposter",
        email: baseEmail,
        password: "anotherPassword456",
      });
      throw new Error("Expected duplicate registration to fail, but it succeeded!");
    } catch (err) {
      if (err.status !== 409) {
        throw new Error(`Expected status 409, got: ${err.status} - ${err.message}`);
      }
    }
  });

  // Test 3: Case-insensitive & trimmed duplicate email rejection
  await test("Case-insensitive & whitespace trimmed email duplicate rejection", async () => {
    const formattedEmail = `  ${baseEmail.toUpperCase()}  `;
    try {
      await userRepo.createUser({
        name: "Alice Cased",
        email: formattedEmail,
        password: "password123",
      });
      throw new Error("Expected case-insensitive duplicate to fail, but it succeeded!");
    } catch (err) {
      if (err.status !== 409) {
        throw new Error(`Expected status 409, got: ${err.status}`);
      }
    }
  });

  // Test 4: Concurrent Duplicate Registration Race Condition Test
  await test("Concurrent registration: 5 simultaneous attempts on same email -> exactly 1 succeeds, 4 fail with 409", async () => {
    const raceEmail = `race_${Date.now()}@example.com`;
    const attempts = Array.from({ length: 5 }, (_, i) =>
      userRepo.createUser({
        name: `Racer ${i}`,
        email: raceEmail,
        password: `password_${i}_secure`,
      }).then(
        (user) => ({ success: true, user }),
        (err) => ({ success: false, status: err.status, message: err.message })
      )
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.success);
    const conflicts = results.filter((r) => !r.success && r.status === 409);

    if (successes.length !== 1) {
      throw new Error(`Expected exactly 1 success, got: ${successes.length}`);
    }
    if (conflicts.length !== 4) {
      throw new Error(`Expected exactly 4 conflicts (409), got: ${conflicts.length}`);
    }

    // Cleanup the winner
    await userRepo.deleteUser(successes[0].user.id);
  });

  // Test 5: Authentication & Password Verification
  await test("Login lookup by email & bcrypt password comparison", async () => {
    const userForAuth = await userRepo.getUserByEmail(baseEmail, { includePassword: true });
    if (!userForAuth) {
      throw new Error("User lookup by email returned null");
    }

    const isValid = await userRepo.verifyPassword("securePassword123", userForAuth.passwordHash);
    if (!isValid) {
      throw new Error("Password verification failed for valid password");
    }

    const isInvalid = await userRepo.verifyPassword("wrongPassword", userForAuth.passwordHash);
    if (isInvalid) {
      throw new Error("Password verification succeeded for invalid password");
    }
  });

  // Test 6: Non-existent User Lookup
  await test("Non-existent user lookup returns null", async () => {
    const nonExistent = await userRepo.getUserByEmail("does_not_exist@example.com");
    if (nonExistent !== null) {
      throw new Error("Expected null for non-existent user");
    }
  });

  // Test 7: User Isolation & Field Protection
  await test("User isolation and password hash suppression by default", async () => {
    const userProfile = await userRepo.getUserById(createdUser.id);
    if (userProfile.passwordHash) {
      throw new Error("Security leak: passwordHash was returned in standard getUserById lookup!");
    }
    if (userProfile.email !== baseEmail.toLowerCase()) {
      throw new Error("User profile email mismatch");
    }
  });

  // Test 8: Clean Deletion & Lock Release
  await test("User deletion releases email lock and permits re-registration", async () => {
    await userRepo.deleteUser(createdUser.id);

    const lookupAfterDelete = await userRepo.getUserByEmail(baseEmail);
    if (lookupAfterDelete !== null) {
      throw new Error("User still exists after deletion");
    }

    // Re-registration with the same email must now succeed
    const reRegistered = await userRepo.createUser({
      name: "Alice Re-born",
      email: baseEmail,
      password: "newPassword999",
    });

    if (!reRegistered.id) {
      throw new Error("Re-registration failed after previous user was deleted");
    }

    // Cleanup
    await userRepo.deleteUser(reRegistered.id);
  });

  console.log("\n=================================================");
  console.log(`Results: ${passed}/${total} tests passed.`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runUserRepoTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
