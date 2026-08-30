import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * TACH 1 (SIYALMAN) — fil mesaj admin<->kliyan pou yon dosye siyalman.
 * Pa gen okenn apèl push isit la espre: spec la limenm eksplisit
 * ("Nouvo siyalman -> notifikasyon bay admin (se tach 2 ki jere kanal
 * yo)") — Tach 1 kreye sèlman ranje `notifications` a (deja fèt sou sèvè a
 * nan add_report_message_secure) + Realtime; Tach 2 se sa k ap deside/
 * konekte push/SMS pou tout evènman yo, san modifye kòd sa a ankò.
 */
export function useReportMessages(reportId: string | undefined) {
  const qc = useQueryClient();

  const messages = useQuery({
    queryKey: ["report-messages", reportId],
    enabled: !!reportId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_messages")
        .select("id, author_id, author_role, message, created_at")
        .eq("report_id", reportId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const send = useMutation({
    mutationFn: async (message: string) => {
      const { error } = await supabase.rpc("add_report_message_secure", {
        _report_id: reportId!,
        _message: message,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-messages", reportId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return { messages, send };
}
