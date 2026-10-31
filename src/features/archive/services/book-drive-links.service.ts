import "server-only";

import { getBook } from "@/features/books/services/book.service";
import { listBookVideoRefs } from "@/features/videos/repositories/video.repository";

import type { BookDriveLinksDto } from "../schemas/archive.dto";
import { getVideoDriveLinks } from "./archive-control.service";

// Where every video of the book is on Drive, oldest first, for the page that follows a batch to its end. A video with no
// finished final render has no `drive` entry.
export async function getBookDriveLinks(bookId: string): Promise<BookDriveLinksDto> {
  const book = await getBook(bookId);
  const videos = await listBookVideoRefs(book.id);
  const drives = await getVideoDriveLinks(videos.map((video) => video.id));
  return { bookId: book.id, videos: videos.map((video) => ({ ...video, drive: drives[video.id] })) };
}
