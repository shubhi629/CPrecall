import jwt from 'jsonwebtoken';

/**
 * Authentication Middleware
 * Validates JWT token from HTTP-only cookie and attaches userId to req.user.
 */
export const requireAuth = (req, res, next) => {
  try {
    let token = req.cookies?.token;

    // Also support Authorization: Bearer <token> for cross-origin browser extensions
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ message: 'Invalid authentication token.' });
  }
};

export default requireAuth;
