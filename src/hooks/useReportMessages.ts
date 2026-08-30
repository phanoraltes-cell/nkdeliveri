import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendReportUpdatePush } from "@/lib/send-report-push.functions";

/**
 * TACH 1 kreye ranje `notifications` a (in-app + Realtime, nan
 * add_report_message_secure). TACH 2 ajoute apèl push la isit la — menm
 * modèl egzat ak useDisputeMessages.ts.
 */
export function useReportMessages(reportId: string | undefined) {
  const qc = useQueryClient();
  const sendPush = useServerFn(sendReportUpdatePush);

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
      try {
        await sendPush({ data: { reportId: reportId! } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-messages", reportId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return { messages, send };
}
