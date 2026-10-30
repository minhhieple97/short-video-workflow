// One shape of a prop's 32×32 art (see prop-art.generated.ts for the encoding).
export type PropShape =
  | readonly ["p", string, string, 0 | 1, number]
  | readonly ["r", number, number, number, number, number, string]
  | readonly ["c", number, number, number, string]
  | readonly ["e", number, number, number, number, string, string];
