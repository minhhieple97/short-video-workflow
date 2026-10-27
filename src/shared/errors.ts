export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string, milestone: string) {
    super("NOT_IMPLEMENTED", `${feature} chưa được triển khai (dự kiến ở ${milestone}).`, 501);
    this.name = "NotImplementedError";
  }
}
