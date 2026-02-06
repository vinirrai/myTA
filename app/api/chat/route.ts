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
import { vectorDatabaseSearch as vectorDatabaseSearchBase } from "./tools/search-vector-database";

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

  // --------- ROUTER (locked retrieval mode) ----------
  const mode = isLogisticsQuery(latestText) ? "logistics" : "content";

  // We will enforce these filters inside the vector tool
  const lockedFilter =
    mode === "logistics"
      ? {
          // ONLY overview/logistics docs (we’ll finalize exact source_name after you confirm it)
          // Example: { source_name: { $eq: "MBA742_Overview" }, chunk_type: { $eq: "text" } }
          mode,
        }
      : {
          // ONLY class materials
          // Example: { source_name: { $startsWith: "Ringel_MBA742_Class" }, chunk_type: { $eq: "text" } }
          mode,
        };

  // Wrap the tool so the model cannot override your filters
  const vectorDatabaseSearch = (args: any) =>
    vectorDatabaseSearchBase({ ...args, lockedFilter });

  const dynamicSystem = `
RETRIEVAL MODE: ${mode}

CITATION RULES:
- For slide answers: cite as "Slide <order> (<source_name>)" and use the slide image URL.
- Show slide images inline using Markdown image syntax: ![](SLIDE_URL)
- Never guess slide content. If slide text is missing, say you don't have slide text.

DISPLAY RULES:
- Max 3 slide images per answer.
- For logistics questions, use ONLY the Overview source and cite it.
`.trim();

  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT + "\n\n" + dynamicSystem,
    messages: convertToModelMessages(messages),
    tools: {
      webSearch, // we can disable this later if you want stricter behavior
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

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
