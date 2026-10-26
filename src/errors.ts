export type ErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL_ERROR';

/** An expected failure with a stable code that is safe to show to the caller. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string, id: string) =>
  new AppError('NOT_FOUND', `${what} '${id}' does not exist`, { id });
