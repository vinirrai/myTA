import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_TOP_K, PINECONE_INDEX_NAME } from "@/config";
import {
  searchResultsToChunks,
  getSourcesFromChunks,
  getContextFromSources,
} from "@/lib/sources";

if (!process.env.PINECONE_API_KEY) throw new Error("PINECONE_API_KEY is not set");

export const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
export const pineconeIndex = pinecone.Index(PINECONE_INDEX_NAME);

type PineconeFilters = {
  source_name?: string;
  chunk_type?: "text" | "image";
};

export async function searchPinecone(
  query: string,
  opts: PineconeFilters = {}
): Promise<string> {
  // Build Pinecone metadata filter (only include what’s set)
  const filter: Record<string, any> = {};
  if (opts.source_name) filter.source_name = { $eq: opts.source_name };
  if (opts.chunk_type) filter.chunk_type = { $eq: opts.chunk_type };

  const results = await pineconeIndex.namespace("default").searchRecords({
    query: {
      inputs: { text: query },
      topK: PINECONE_TOP_K,
      ...(Object.keys(filter).length ? { filter } : {}),
    },
    fields: [
      "text",
      "pre_context",
      "post_context",
      "source_url",
      "source_description",
      "source_type",
      "source_name",
      "chunk_type",
      "order",
    ],
  });

  // Convert to chunks (existing behavior)
  const chunks = searchResultsToChunks(results);

  // --- Slide-wise grouping (keeps 1–2 chunks per slide) ---
  // Groups by source_name + order so citations stay slide-wise
  const grouped: typeof chunks = [];
  const seen = new Set<string>();

  for (const c of chunks) {
    const md: any = c.metadata ?? {};
    const key = `${md.source_name ?? ""}::${md.order ?? ""}`;

    // keep first hit per slide (optionally keep 2; simplest: 1)
    if (!seen.has(key)) {
      seen.add(key);
      grouped.push(c);
    }
  }

  const sources = getSourcesFromChunks(grouped);
  const context = getContextFromSources(sources);

  return `<results>\n${context}\n</results>`;
}
