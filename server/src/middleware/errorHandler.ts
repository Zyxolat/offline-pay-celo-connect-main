import { Request, Response, NextFunction } from 'express';
import { normalizeError } from '../utils/logger';

export interface ApiError extends Error {
  status?: number;
  details?: any;
}

export const errorHandler = (err: ApiError, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error('[ERROR]', {
    ...normalizeError(err),
    details: err.details,
    path: req.originalUrl,
    method: req.method,
  });

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { details: err.details || err.stack }),
  });
};

export const createError = (message: string, status: number = 500, details?: any): ApiError => {
  const error: ApiError = new Error(message);
  error.status = status;
  error.details = details;
  return error;
};
