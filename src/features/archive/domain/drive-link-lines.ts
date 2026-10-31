// One line per video that has a link on Drive, "title<TAB>link", so a paste into a sheet makes two columns. A title is
// squeezed onto one line first, because a tab or a line break inside it would break the columns.
export function formatDriveLinkLines(videos: readonly { title: string; videoUrl: string | null }[]): string {
  return videos
    .flatMap((video) => (video.videoUrl ? [`${video.title.replace(/\s+/g, " ").trim()}\t${video.videoUrl}`] : []))
    .join("\n");
}
