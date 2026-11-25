import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getCookieOptions, getClearCookieOptions } from '../config/cookieConfig.js';
import { isDynamoDB } from '../config/dbBackend.js';
import userRepo from '../repositories/userRepo.js';

// Helper to generate JWT token
const signToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * @desc    Register new user
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide name, email, and password.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    let user;
    if (isDynamoDB()) {
      const existingUser = await userRepo.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
      user = await userRepo.createUser({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password,
      });
    } else {
      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
      if (existingUser) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }

      user = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash: password,
      });
    }

    // Generate JWT & set HTTP-only cookie
    const userId = user.id || user._id;
    const token = signToken(userId);
    res.cookie('token', token, getCookieOptions());

    return res.status(201).json({
      token,
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Log in user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password.' });
    }

    let user;
    let isMatch = false;

    if (isDynamoDB()) {
      user = await userRepo.getUserByEmail(email, { includePassword: true });
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }
      isMatch = await user.comparePassword(password);
    } else {
      // Find user and include passwordHash
      user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }
      // Verify password
      isMatch = await user.comparePassword(password);
    }

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT & set HTTP-only cookie
    const userId = user.id || user._id;
    const token = signToken(userId);
    res.cookie('token', token, getCookieOptions());

    return res.status(200).json({
      token,
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get currently authenticated user
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getCurrentUser = async (req, res, next) => {
  try {
    let user;
    if (isDynamoDB()) {
      user = await userRepo.getUserById(req.user.userId);
    } else {
      user = await User.findById(req.user.userId);
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userId = user.id || user._id;
    // Re-sign a fresh token so /me can also refresh the client's Bearer token
    const freshToken = signToken(userId.toString());
    return res.status(200).json({
      token: freshToken,
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Log out user / Clear cookie
 * @route   POST /api/auth/logout
 * @access  Public
 */
export const logout = async (req, res) => {
  res.clearCookie('token', getClearCookieOptions());
  return res.status(200).json({ message: 'Logged out successfully.' });
};
