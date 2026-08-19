import type { ApiErrorCode } from "@scrum-poker/protocol";

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}
