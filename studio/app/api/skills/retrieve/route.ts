import { NextRequest } from "next/server";
import {
  authorizeSkillRetrieval,
  readSkillRetrievalInput,
  retrieveSkillSources,
  skillErrorResponse,
  skillJson,
} from "@/app/lib/skills-retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await authorizeSkillRetrieval(req);
    const { kind, query, mode } = await readSkillRetrievalInput(req);
    return skillJson(
      await retrieveSkillSources(kind, query, req.signal, req, mode),
    );
  } catch (error) {
    return skillErrorResponse(error);
  }
}
