/**
 * Validation utilities replicating Mongoose schema validation rules
 */

const EMAIL_REGEX = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

export function validateUserRegistration({ name, email, password }) {
  const errors = [];

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    errors.push("Please provide a name");
  } else if (name.trim().length > 50) {
    errors.push("Name cannot exceed 50 characters");
  }

  if (!email || typeof email !== "string" || email.trim().length === 0) {
    errors.push("Please provide an email address");
  } else if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
    errors.push("Please provide a valid email address");
  }

  if (!password || typeof password !== "string" || password.length === 0) {
    errors.push("Please provide a password");
  } else if (password.length < 6) {
    errors.push("Password must be at least 6 characters long.");
  }

  if (errors.length > 0) {
    const error = new Error(errors[0]);
    error.status = 400;
    error.validationErrors = errors;
    throw error;
  }

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
  };
}

export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}
