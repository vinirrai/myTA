import { tool } from "ai";
import { z } from "zod";
import { searchPinecone } from "@/lib/pinecone";

export const vectorDatabaseSearch = tool({
  description: "Search the vector database for information",
  inputSchema: z.object({
    query: z.string().describe(
      "The query to search the vector database for. Optimally a hypothetical answer for similarity search."
    ),

    // OPTIONAL — safe defaults
    source_name: z.string().optional(),
    chunk_type: z.enum(["text", "image"]).optional(),
  }),

  execute: async ({ query, source_name, chunk_type }) => {
    return await searchPinecone(query, {
      source_name,
      chunk_type,
    });
  },
});
