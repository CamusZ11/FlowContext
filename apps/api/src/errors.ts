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
export const notFound = () => new ApiError(404, "not_found");
export const conflict = () => new ApiError(409, "conflict");
