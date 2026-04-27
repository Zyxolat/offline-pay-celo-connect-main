import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

const jsonRateLimitHandler = (message: string) => (_req: Request, res: Response) => {
  res.status(429).json({
    success: false,
    error: message,
  });
};

export const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many requests, please try again later.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 minutes (increased to avoid false 429s during normal use)
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many failed attempts, please try again later.'),
});

export const passkeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many passkey attempts, please try again later.'),
});

export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 payments per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Rate limit exceeded for payments.'),
});
