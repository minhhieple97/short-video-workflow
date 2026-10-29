import {
  PUBLISH_CAPTION_MAX,
  PUBLISH_HASHTAGS_MAX,
  PUBLISH_HASHTAGS_MIN,
  PUBLISH_TITLE_MAX,
} from "@/features/videos/domain/publish-metadata";

// Every prompt that writes a title, caption and hashtags uses this text, so changing it means bumping each of their
// versions (video-script, scene-plan, publish-metadata).
export const PUBLISH_RULE = [
  "- publish: tiêu đề, caption và hashtag để đăng video, một bộ dùng chung cho TikTok, Facebook Reels và YouTube Shorts. Viết để người đang lướt dừng lại xem, và để nền tảng hiểu video nói về gì khi gợi ý và tìm kiếm.",
  `  title: một dòng, tối đa ${PUBLISH_TITLE_MAX} ký tự. Từ khoá chính (chủ đề bài học hoặc tên sách) nằm trong khoảng 40 ký tự đầu. Gợi tò mò nhưng không clickbait sai lệch: video phải trả lời được điều tiêu đề hứa.`,
  `  caption: dòng đầu là câu móc ngắn dưới 120 ký tự (phần hiện trước "xem thêm"); tiếp theo 2–4 dòng ngắn nói người xem nhận được gì; một dòng nguồn "Sách: <tên sách> – <tác giả>" (bỏ tác giả nếu không rõ); cuối cùng một lời mời hành động (lưu lại, bình luận hoặc theo dõi). Khoảng 150–400 ký tự, tối đa ${PUBLISH_CAPTION_MAX}. Không đặt hashtag trong tiêu đề hay caption.`,
  `  hashtags: ${PUBLISH_HASHTAGS_MIN}–${PUBLISH_HASHTAGS_MAX} thẻ (nên 5–8), viết liền, không dấu, chữ thường: 1–2 thẻ rộng về sách và bài học cuộc sống (như sachhay, baihoccuocsong), 2–4 thẻ đúng chủ đề bài học, 1 thẻ theo tên sách; được dùng thẻ cộng đồng quen thuộc như booktok, reviewsach. Không dùng thẻ trend không liên quan.`,
  "  Chỉ dùng ý có trong kịch bản, bài học và tên sách: không thêm số liệu, trích dẫn, lời tác giả hay lời hứa mà video không có. Emoji dùng tiết chế, nhiều nhất 3.",
].join("\n");

export const PUBLISH_JSON = '"publish":{"title","caption","hashtags":[]}';
