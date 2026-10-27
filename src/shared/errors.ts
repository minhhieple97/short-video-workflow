export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 500,
    options?: ErrorOptions & { details?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = "AppError";
    this.details = options?.details;
  }

  readonly details: Record<string, unknown> | undefined;
}

export class NotImplementedError extends AppError {
  constructor(feature: string, milestone: string) {
    super("NOT_IMPLEMENTED", `${feature} chưa được triển khai (dự kiến ở ${milestone}).`, 501);
    this.name = "NotImplementedError";
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class JobCancelledError extends AppError {
  constructor() {
    super("JOB_CANCELLED", "Tác vụ đã bị huỷ.", 409);
    this.name = "JobCancelledError";
  }
}
