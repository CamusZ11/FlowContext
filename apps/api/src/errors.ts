export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const deviceUnauthorized = () => new ApiError(401, "device_unauthorized");
export const invalidRequest = () => new ApiError(422, "invalid_request");
