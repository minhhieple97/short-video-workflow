export const DEFAULT_PAGE_SIZE = 25;

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  // The page actually served: a request past the end lands on the last page.
  page: number;
  pageSize: number;
  pageCount: number;
}

// ?page=… from the address bar: anything that is not a positive whole number is the first page.
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export function toPageRequest(value: string | string[] | undefined, pageSize = DEFAULT_PAGE_SIZE): PageRequest {
  return { page: parsePageParam(value), pageSize };
}

function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Counts first, then reads only the requested rows, so a page past the end (rows deleted, a filter changed) is served as
// the last page instead of coming back empty.
export async function loadPage<T>(
  request: PageRequest,
  source: { count: () => Promise<number>; fetch: (range: { skip: number; take: number }) => Promise<T[]> },
): Promise<Page<T>> {
  const total = await source.count();
  const pageCount = pageCountOf(total, request.pageSize);
  const page = Math.min(request.page, pageCount);
  const items = total === 0 ? [] : await source.fetch({ skip: (page - 1) * request.pageSize, take: request.pageSize });
  return { items, total, page, pageSize: request.pageSize, pageCount };
}

// For lists the database cannot filter itself (the book search folds diacritics in memory).
export function slicePage<T>(all: readonly T[], request: PageRequest): Page<T> {
  const pageCount = pageCountOf(all.length, request.pageSize);
  const page = Math.min(request.page, pageCount);
  const start = (page - 1) * request.pageSize;
  return {
    items: all.slice(start, start + request.pageSize),
    total: all.length,
    page,
    pageSize: request.pageSize,
    pageCount,
  };
}

export function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { ...page, items: page.items.map(map) };
}

// The page numbers a pager shows: the first, the last and the neighbours of the current one, with `null` for each gap.
export function pageWindow(page: number, pageCount: number, radius = 2): (number | null)[] {
  const wanted = new Set([1, pageCount]);
  for (let n = page - radius; n <= page + radius; n += 1) {
    if (n >= 1 && n <= pageCount) wanted.add(n);
  }
  const numbers = [...wanted].sort((a, b) => a - b);
  const entries: (number | null)[] = [];
  numbers.forEach((n, index) => {
    const before = numbers[index - 1];
    if (before !== undefined && n - before > 1) entries.push(n - before === 2 ? n - 1 : null);
    entries.push(n);
  });
  return entries;
}
