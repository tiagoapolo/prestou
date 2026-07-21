export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function userMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError ? error.message : fallback;
}
