import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';
import { isDynamoDB, isDualWrite } from './config/dbBackend.js';
import problemRepo from './repositories/problemRepo.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Bind to PORT immediately so Render & Vercel proxy detect readiness in <100ms
    app.listen(PORT, () => {
      console.log(`[CPRecal API] Server running on port ${PORT}`);
      console.log(`[CPRecal API] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize catalog and secondary database in the background without blocking the HTTP listener
    (async () => {
      try {
        if (isDynamoDB()) {
          console.log('[CPRecal API] Backend: AWS DynamoDB (Primary)');
          await problemRepo.initCatalog();
          console.log('[CPRecal API] DynamoDB problem catalog initialized');

          if (isDualWrite()) {
            console.log('[CPRecal API] Dual-write enabled: Connecting to MongoDB (Standby)...');
            await connectDB();
            console.log('[CPRecal API] MongoDB standby connected for shadow sync');
          }
        } else {
          await connectDB();
          if (isDualWrite()) {
            await problemRepo.initCatalog();
          }
        }
      } catch (bgErr) {
        console.error('[CPRecal API] Background initialization error:', bgErr.message);
      }
    })();
  } catch (error) {
    console.error('[CPRecal API] Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
