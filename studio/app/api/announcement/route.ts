import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface Announcement {
  id: string;
  title: string;
  content: string;
  type?: "info" | "warning" | "update";
}

export async function POST() {
  const announcementId = process.env.ANNOUNCEMENT_ID;
  const announcementTitle = process.env.ANNOUNCEMENT_TITLE;
  const announcementContent = process.env.ANNOUNCEMENT_CONTENT;
  const announcementType = process.env.ANNOUNCEMENT_TYPE || "info";

  if (!announcementId || !announcementTitle || !announcementContent) {
    return NextResponse.json({ announcement: null });
  }

  const announcement: Announcement = {
    id: announcementId,
    title: announcementTitle,
    content: announcementContent,
    type: announcementType as Announcement["type"],
  };

  return NextResponse.json({ announcement });
}

export async function GET() {
  return POST();
}
