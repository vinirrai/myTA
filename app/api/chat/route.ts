import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { MODEL } from "@/config";
import { SYSTEM_PROMPT } from "@/prompts";
import { isContentFlagged } from "@/lib/moderation";
import { webSearch } from "./tools/web-search";
import { vectorDatabaseSearch } from "./tools/search-vector-database";

export const maxDuration = 30;

function getLatestUserText(messages: UIMessage[]) {
  const latestUserMessage = messages.filter((m) => m.role === "user").pop();
  if (!latestUserMessage) return "";
  return latestUserMessage.parts
    .filter((p) => p.type === "text")
    .map((p: any) => ("text" in p ? p.text : ""))
    .join("")
    .trim();
}

function isLogisticsQuery(q: string) {
  const s = q.toLowerCase();
  const keywords = [
    "syllabus",
    "overview",
    "grade",
    "grading",
    "breakdown",
    "deadline",
    "late",
    "attendance",
    "policy",
    "participation",
    "office hours",
    "exam",
    "midterm",
    "final",
    "capstone",
    "quiz",
  ];
  return keywords.some((k) => s.includes(k));
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const latestText = getLatestUserText(messages);

  // --- Moderation gate (unchanged behavior) ---
  if (latestText) {
    const moderationResult = await isContentFlagged(latestText);

    if (moderationResult.flagged) {
      const stream = createUIMessageStream({
        execute({ writer }) {
          const textId = "moderation-denial-text";

          writer.write({ type: "start" });
          writer.write({ type: "text-start", id: textId });
          writer.write({
            type: "text-delta",
            id: textId,
            delta:
              moderationResult.denialMessage ||
              "Your message violates our guidelines. I can't answer that.",
          });
          writer.write({ type: "text-end", id: textId });
          writer.write({ type: "finish" });
        },
      });

      return createUIMessageStreamResponse({ stream });
    }
  }

  // --------- ROUTER (instruction-based; hard guardrails are in lib/pinecone.ts) ----------
  const mode = isLogisticsQuery(latestText) ? "logistics" : "content";

  // NOTE: Replace this with your real Overview source_name once ingested.
  const OVERVIEW_SOURCE_NAME = "MBA742_Overview";

  const dynamicSystem = `
RETRIEVAL MODE: ${mode}

TOOL USAGE (MANDATORY):
- Always call vectorDatabaseSearch before answering.
- For content questions: call vectorDatabaseSearch with {"query": "...", "chunk_type": "text"}.
- For logistics questions: call vectorDatabaseSearch with {"query": "...", "chunk_type": "text", "source_name": "${OVERVIEW_SOURCE_NAME}"}.

CITATIONS:
- For slide answers: cite as "Slide <order> (<source_name>)" and include the slide image URL.
- Do not guess slide content. If slide text is missing, say you don't have it.
- Show up to 3 slide images inline using Markdown image syntax: ![](SLIDE_URL)
`.trim();

  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT + "\n\n" + dynamicSystem,
    messages: convertToModelMessages(messages),
    tools: {
      webSearch,
      vectorDatabaseSearch,
    },
    stopWhen: stepCountIs(10),
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
        reasoningEffort: "low",
        parallelToolCalls: false,
      },
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
