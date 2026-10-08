export class AppError extends Error {
  constructor(public code: string, public status: number, public userMessage: string, public details?: unknown) {
    super(userMessage);
  }
}
export const notFound = (what: string) => new AppError('NOT_FOUND', 404, `${what} was not found.`);
