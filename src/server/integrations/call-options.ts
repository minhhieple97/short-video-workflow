export interface CallOptions {
  // An aborted signal must make the call reject before it causes any remote side effect.
  signal?: AbortSignal;
}
