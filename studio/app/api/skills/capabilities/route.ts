import { NextRequest } from "next/server";
import {
  authorizeSkillRetrieval,
  skillErrorResponse,
  skillJson,
  skillRetrievalCapabilities,
} from "@/app/lib/skills-retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await authorizeSkillRetrieval(req);
    return skillJson(skillRetrievalCapabilities());
  } catch (error) {
    return skillErrorResponse(error);
  }
}
