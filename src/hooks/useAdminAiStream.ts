import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * TACH 2 (ASISTAN AI ADMIN) — konsomasyon SSE pou wout brit
 * `api.admin.ai.ts`. Se yon `fetch` manyèl (pa `EventSource`, ki pa
 * pèmèt POST/tèt Authorization pèsonalize) — li rekonstwi chak "event:
 * .../data: ..." blòk soti nan flux HTTP a.
 *
 * Tèt Authorization mete MANYÈLMAN isit la (pa via `attachSupabaseAuth`,
 * ki se yon middleware pou `createServerFn` RPC sèlman, pa yon `fetch`
 * brit tankou sa a).
 */
export function useAdminAiStream() {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ cached?: boolean; generatedAt?: string } | null>(null);

  const run = useCallback(async (payload: Record<string, unknown>) => {
    setText("");
    setError(null);
    setMeta(null);
    setStreaming(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(errBody.error || `Erè sèvè (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const event = eventLine?.slice("event: ".length) ?? "message";
          const data = JSON.parse(dataLine.slice("data: ".length));
          if (event === "delta") setText((t) => t + data.text);
          else if (event === "error") streamError = data.message;
          else if (event === "done")
            setMeta({ cached: data.cached, generatedAt: data.generatedAt });
        }
      }
      if (streamError) throw new Error(streamError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erè enkoni");
    } finally {
      setStreaming(false);
    }
  }, []);

  return { text, streaming, error, meta, run };
}
