"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  CheckCheck,
  Headphones,
  Loader2,
  Paperclip,
  Search,
  Send,
  Settings,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/hooks/use-api";
import { SUPPORT_UNREAD_QUERY_KEY } from "@/lib/hooks/use-support-unread";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions/rbac";
import { SUPPORT_SEARCH_DEBOUNCE_MS, supportConversationsQueryString } from "@/modules/support/search";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  type MemberRole,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from "@/types/domain";

type Settings = {
  enabled: boolean;
  flagged: boolean;
  mode: "postbus_global" | "merchant_vachat";
  vachatReady: boolean;
  globalSupport: boolean;
  vachatStatus: string;
};
type Conversation = {
  id: string;
  phoneDigits: string;
  customerName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  channelKind?: "postbus_global" | "merchant_vachat";
  ticket: {
    id: string;
    public_number: string;
    status: SupportTicketStatus;
    priority: string;
    category: string;
    assigned_to: string | null;
  } | null;
};
type Message = {
  id: string;
  direction: string;
  body: string | null;
  status: string;
  createdAt: string;
  contentType: string;
};

const FILTERS = ["all", "unread", "open", "pending", "resolved", "closed", "unassigned", "mine"] as const;

const FILTER_LABELS: Record<(typeof FILTERS)[number], string> = {
  all: "All",
  unread: "Unread",
  open: "Open",
  pending: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
  unassigned: "Unassigned",
  mine: "Assigned to me",
};

const WORKFLOW_ACTIONS = [
  { status: "under_review", label: "Review" },
  { status: "needs_info", label: "Need info" },
  { status: "approved", label: "Approve" },
  { status: "rejected", label: "Reject" },
] as const;

function remainingLabel(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours <= 0 && minutes <= 0) return "less than 1 min left";
  if (hours <= 0) return `${minutes} min left to reply`;
  return `${hours}h ${minutes}m left to reply`;
}

function SupportTips({
  tips,
}: {
  tips: Array<{ title: string; text: string }>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {tips.map((tip) => (
        <div key={tip.title} className="rounded-xl border border-border bg-card px-3 py-2.5">
          <p className="text-xs font-semibold text-ink">{tip.title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted">{tip.text}</p>
        </div>
      ))}
    </div>
  );
}

const INBOX_TIPS = [
  { title: "Reply", text: "Type a message while the 24-hour window is open." },
  { title: "After 24 hours", text: "Send an approved WhatsApp template to reach the customer again." },
  { title: "Details", text: "Open a chat to see the order, shipment, and ticket." },
];

const SETTINGS_TIPS = [
  { title: "Inbox", text: "Customer WhatsApp chats appear here. Open one to reply." },
  { title: "Tickets", text: "Each request gets a ticket: cancel, return, refund, or delivery." },
  { title: "WhatsApp number", text: "Use PostBus or your own number. Shipping alerts stay separate." },
];

const OFF_TIPS = [
  { title: "Turn it on", text: "Open Settings, then enable Support. Chats start after a customer writes." },
  { title: "Reply window", text: "Free-text replies work for 24 hours after the customer’s last message." },
  { title: "Team notes", text: "Internal notes stay in PostBus. They are not sent to the customer." },
];

export function SupportWorkspace() {
  const me = useMe();
  const role = (me.data?.role ?? "VIEWER") as MemberRole;
  const organizationId = me.data?.organization?.id;
  const queryClient = useQueryClient();
  const [view, setView] = useState<"inbox" | "tickets" | "settings">("inbox");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [category, setCategory] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [contextOpen, setContextOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [note, setNote] = useState("");
  const [merchantKey, setMerchantKey] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["support", "settings"],
    queryFn: () => api<Settings>("/api/v1/support/settings"),
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, SUPPORT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const conversationsQuery = useQuery({
    queryKey: ["support", "conversations", filter, category, searchQuery],
    queryFn: () =>
      api<{ items: Conversation[] }>(supportConversationsQueryString({ filter, category, q: searchQuery })),
    enabled: Boolean(settingsQuery.data?.enabled) && view !== "settings",
  });
  const ticketsQuery = useQuery({
    queryKey: ["support", "tickets"],
    queryFn: () => api<{ items: Array<{ id: string; publicNumber: string; status: string; category: string }> }>(
      "/api/v1/support/tickets"
    ),
    enabled: Boolean(settingsQuery.data?.enabled) && view === "tickets",
  });
  const contextQuery = useQuery({
    queryKey: ["support", "context", selectedId],
    queryFn: () => api<Record<string, unknown>>(`/api/v1/support/conversations/${selectedId}/context`),
    enabled: Boolean(selectedId && settingsQuery.data?.enabled),
  });
  const messagesQuery = useQuery({
    queryKey: ["support", "messages", selectedId],
    queryFn: () => api<{ items: Message[] }>(`/api/v1/support/conversations/${selectedId}/messages`),
    enabled: Boolean(selectedId && settingsQuery.data?.enabled),
  });
  const templatesQuery = useQuery({
    queryKey: ["support", "templates"],
    queryFn: () => api<{ items: Array<{ name: string; language: string }> }>("/api/v1/support/templates"),
    enabled: Boolean(settingsQuery.data?.enabled && selectedId),
  });
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => api<{ items: Array<{ id: string; userId: string; fullName?: string; email?: string; role: string }> }>("/api/v1/members"),
    enabled: hasPermission(role, "support.assign"),
  });

  useEffect(() => {
    if (!organizationId || !settingsQuery.data?.enabled) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`support:${organizationId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations", filter: `organization_id=eq.${organizationId}` }, () => {
          void queryClient.invalidateQueries({ queryKey: ["support"] });
          void queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "support_messages", filter: `organization_id=eq.${organizationId}` }, () => {
          void queryClient.invalidateQueries({ queryKey: ["support", "messages"] });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets", filter: `organization_id=eq.${organizationId}` }, () => {
          void queryClient.invalidateQueries({ queryKey: ["support"] });
        })
        .subscribe();
    } catch {
      // query refetch still works
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient, settingsQuery.data?.enabled]);

  const enableMutation = useMutation({
    mutationFn: (body: { enabled?: boolean; mode?: Settings["mode"] }) =>
      api<Settings>("/api/v1/support/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["support", "settings"], data);
      if (variables.mode && variables.mode !== settingsQuery.data?.mode) {
        toast.success("Customers will now write to a different WhatsApp number.");
      } else {
        toast.success(data.enabled ? "Support is on. New chats will appear in Inbox." : "Support is off. New chats will not appear.");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update settings."),
  });
  const vachatConnect = useMutation({
    mutationFn: async () => {
      await api("/api/v1/integrations/vachat", {
        method: "POST",
        body: JSON.stringify({ apiKey: merchantKey }),
      });
      await api("/api/v1/integrations/vachat/test", { method: "POST" });
      setMerchantKey("");
      return api<Settings>("/api/v1/support/settings", {
        method: "PATCH",
        body: JSON.stringify({ mode: "merchant_vachat" }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["support", "settings"], data);
      toast.success("Your WhatsApp is connected. New customer chats will use that number.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not connect Vachat."),
  });
  const vachatTest = useMutation({
    mutationFn: () => api("/api/v1/integrations/vachat/test", { method: "POST" }),
    onSuccess: () => toast.success("Your WhatsApp key works."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Test failed."),
  });
  const vachatDisconnect = useMutation({
    mutationFn: () => api("/api/v1/integrations/vachat", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Your WhatsApp is disconnected. Switch to PostBus WhatsApp in Settings if you still need chats.");
      void queryClient.invalidateQueries({ queryKey: ["support", "settings"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not disconnect."),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api(`/api/v1/support/conversations/${selectedId}/messages`, {
        method: "POST",
        body: JSON.stringify({ clientSendId: crypto.randomUUID(), text: draft }),
      }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not send."),
  });

  const templateMutation = useMutation({
    mutationFn: () =>
      api(`/api/v1/support/conversations/${selectedId}/templates`, {
        method: "POST",
        body: JSON.stringify({ clientSendId: crypto.randomUUID(), templateName }),
      }),
    onSuccess: () => {
      setTemplateName("");
      toast.success("Template sent.");
      void queryClient.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not send template."),
  });

  const items = conversationsQuery.data?.items ?? [];
  const selected = items.find((row) => row.id === selectedId) ?? null;
  const context = contextQuery.data as {
    conversation?: { windowOpen?: boolean; windowRemainingMs?: number; phoneDigits?: string; customerName?: string | null };
    ticket?: {
      id: string;
      publicNumber: string;
      status: SupportTicketStatus;
      priority: string;
      category: SupportTicketCategory;
      assignedTo: string | null;
    } | null;
    order?: { id: string; order_number: string; status: string; payment_status: string; total_amount: number; order_line_items?: Array<{ title: string; quantity: number; image_url?: string }> } | null;
    shipment?: { tracking_number?: string; barcode?: string; status?: string; booked_at?: string } | null;
    orderMatches?: Array<{ id: string; orderNumber: string }>;
    timeline?: { workflow?: { kind: string; status: string } | null };
  } | undefined;
  const windowOpen = Boolean(context?.conversation?.windowOpen);
  const canReply = hasPermission(role, "support.reply");
  const canManage = hasPermission(role, "support.manage");
  const canSettings = hasPermission(role, "support.settings");
  const isOwner = role === "OWNER";

  const contextPanel = useMemo(() => {
    if (!context) {
      return <p className="p-4 text-sm text-muted">Open a chat to see the customer, order, and ticket.</p>;
    }
    return (
      <div className="space-y-5 p-4 text-sm">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Customer</h3>
          <p className="mt-1 font-medium text-ink">{context.conversation?.customerName || "WhatsApp customer"}</p>
          <p className="text-muted">+91 {context.conversation?.phoneDigits}</p>
        </section>
        {context.ticket ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Ticket</h3>
            <p className="font-medium">{context.ticket.publicNumber}</p>
            <p className="text-xs text-muted">
              {SUPPORT_TICKET_CATEGORY_LABELS[context.ticket.category] ?? context.ticket.category}
              {" · "}
              {SUPPORT_TICKET_PRIORITY_LABELS[context.ticket.priority as keyof typeof SUPPORT_TICKET_PRIORITY_LABELS] ?? context.ticket.priority}
            </p>
            <Badge>{SUPPORT_TICKET_STATUS_LABELS[context.ticket.status]}</Badge>
            {canManage ? (
              <Select
                value={context.ticket.status}
                onValueChange={async (status) => {
                  try {
                    await api(`/api/v1/support/tickets/${context.ticket!.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        status,
                        resolutionNote: status === "resolved" ? "Resolved from Support." : undefined,
                      }),
                    });
                    void queryClient.invalidateQueries({ queryKey: ["support"] });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Status update failed.");
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SUPPORT_TICKET_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {hasPermission(role, "support.assign") ? (
              <Select
                value={context.ticket.assignedTo ?? "none"}
                onValueChange={async (value) => {
                  await api(`/api/v1/support/tickets/${context.ticket!.id}/assign`, {
                    method: "POST",
                    body: JSON.stringify({ assignedTo: value === "none" ? null : value }),
                  });
                  void queryClient.invalidateQueries({ queryKey: ["support"] });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Assign" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(membersQuery.data?.items ?? []).map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>{member.fullName || member.email || member.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </section>
        ) : null}
        {context.order ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Order</h3>
            <p className="mt-1 font-medium">{context.order.order_number}</p>
            <p className="text-muted">{context.order.status} · {context.order.payment_status}</p>
            <p>{formatCurrency(context.order.total_amount)}</p>
            <div className="mt-2 space-y-1">
              {(context.order.order_line_items ?? []).map((item) => (
                <p key={item.title}>{item.quantity} × {item.title}</p>
              ))}
            </div>
            <Link className="mt-2 inline-block text-brand" href={`/dashboard/orders/${context.order.id}`}>View order</Link>
          </section>
        ) : context.orderMatches && context.orderMatches.length > 1 ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Matching orders</h3>
            <p className="text-muted">More than one order matches this number. Pick the right one before you approve.</p>
            {context.orderMatches.map((match) => (
              <Button
                key={match.id}
                variant="secondary"
                size="sm"
                className="mt-1 w-full"
                onClick={async () => {
                  if (!context.ticket) return;
                  await api(`/api/v1/support/tickets/${context.ticket.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ orderId: match.id }),
                  });
                  void queryClient.invalidateQueries({ queryKey: ["support", "context", selectedId] });
                }}
              >
                {match.orderNumber}
              </Button>
            ))}
          </section>
        ) : (
          <p className="text-muted">No order linked yet. Link one if this chat is about a purchase.</p>
        )}
        {context.shipment ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Shipping</h3>
            <p className="font-medium">{context.shipment.tracking_number || context.shipment.barcode}</p>
            <p className="text-muted">{context.shipment.status}</p>
            {context.shipment.booked_at ? <p>Booked {formatDate(context.shipment.booked_at)}</p> : null}
          </section>
        ) : null}
        {context.timeline?.workflow && canManage ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Request</h3>
            <p className="capitalize">{context.timeline.workflow.kind} · {context.timeline.workflow.status.replaceAll("_", " ")}</p>
            {WORKFLOW_ACTIONS.map((action) => (
              <Button
                key={action.status}
                size="sm"
                variant="secondary"
                className="mr-1"
                onClick={async () => {
                  try {
                    await api(`/api/v1/support/tickets/${context.ticket!.id}/workflow`, {
                      method: "PATCH",
                      body: JSON.stringify({ status: action.status }),
                    });
                    void queryClient.invalidateQueries({ queryKey: ["support"] });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not update this request.");
                  }
                }}
              >
                {action.label}
              </Button>
            ))}
          </section>
        ) : null}
        {canReply && context.ticket ? (
          <section className="space-y-2">
            <Label htmlFor="internal-note">Team note</Label>
            <p className="text-xs text-muted">Only your team sees this. It is not sent on WhatsApp.</p>
            <Textarea id="internal-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a private note" />
            <Button
              size="sm"
              variant="secondary"
              disabled={!note.trim()}
              onClick={async () => {
                await api(`/api/v1/support/tickets/${context.ticket!.id}/notes`, {
                  method: "POST",
                  body: JSON.stringify({ body: note }),
                });
                setNote("");
                toast.success("Team note saved. The customer cannot see it.");
              }}
            >
              Add note
            </Button>
          </section>
        ) : null}
      </div>
    );
  }, [canManage, canReply, context, membersQuery.data, note, queryClient, role, selectedId]);

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col gap-3">
      <PageHeader
        title="Support Center"
        description="Reply to customer WhatsApp chats and track tickets."
        icon={<Headphones className="size-6 text-brand" />}
        actions={
          <div className="flex gap-1">
            <Button variant={view === "inbox" ? "primary" : "secondary"} size="sm" onClick={() => setView("inbox")}>Inbox</Button>
            <Button variant={view === "tickets" ? "primary" : "secondary"} size="sm" onClick={() => setView("tickets")}>Tickets</Button>
            {canSettings ? (
              <Button variant={view === "settings" ? "primary" : "secondary"} size="sm" onClick={() => setView("settings")}>
                <Settings className="mr-1 size-4" /> Settings
              </Button>
            ) : null}
          </div>
        }
      />

      {settingsQuery.isLoading ? (
        <p className="text-sm text-muted">Loading Support…</p>
      ) : view === "settings" ? (
        <div className="max-w-2xl space-y-4">
          <SupportTips tips={SETTINGS_TIPS} />
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Turn on Support</h2>
                <p className="text-sm text-muted">
                  Customer chats appear in Inbox. Shipment WhatsApp alerts keep sending as usual.
                </p>
              </div>
              <Switch
                checked={Boolean(settingsQuery.data?.flagged)}
                disabled={!canSettings || enableMutation.isPending}
                onCheckedChange={(checked) => enableMutation.mutate({ enabled: checked })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">PostBus WhatsApp</h3>
                {settingsQuery.data?.mode === "postbus_global" ? <Badge variant="brand">Active</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                Customers write to the PostBus number. No API key. PostBus must allow support on this number.
              </p>
              <p className="mt-2 text-xs text-muted">
                {settingsQuery.data?.globalSupport
                  ? "Ready. You can use this number for chats."
                  : "Not available yet. Ask PostBus to turn it on, or use your own number."}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                disabled={
                  !isOwner ||
                  enableMutation.isPending ||
                  settingsQuery.data?.mode === "postbus_global" ||
                  !settingsQuery.data?.globalSupport
                }
                onClick={() => {
                  if (
                    !window.confirm(
                      "Customers will start writing to a different WhatsApp number. Continue?"
                    )
                  ) {
                    return;
                  }
                  enableMutation.mutate({ mode: "postbus_global" });
                }}
              >
                Use PostBus WhatsApp
              </Button>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Your WhatsApp</h3>
                {settingsQuery.data?.mode === "merchant_vachat" ? <Badge variant="brand">Active</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                Optional. Customers write to your number. If this connection fails, chats do not switch to PostBus on their own.
              </p>
              <p className="mt-2 text-xs text-muted">
                Status: {settingsQuery.data?.vachatStatus ?? "NOT_CONNECTED"}
              </p>
              <Input
                className="mt-3"
                type="password"
                autoComplete="new-password"
                placeholder="Your Vachat API key"
                value={merchantKey}
                onChange={(event) => setMerchantKey(event.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!isOwner || !merchantKey.trim() || vachatConnect.isPending}
                  onClick={() => {
                    if (
                      settingsQuery.data?.mode !== "merchant_vachat" &&
                      !window.confirm(
                        "Customers will start writing to a different WhatsApp number. Continue?"
                      )
                    ) {
                      return;
                    }
                    vachatConnect.mutate();
                  }}
                >
                  Connect & use
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!settingsQuery.data?.vachatReady || vachatTest.isPending}
                  onClick={() => vachatTest.mutate()}
                >
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!isOwner || !settingsQuery.data?.vachatReady || enableMutation.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Customers will start writing to a different WhatsApp number. Continue?"
                      )
                    ) {
                      return;
                    }
                    enableMutation.mutate({ mode: "merchant_vachat" });
                  }}
                >
                  Use this number
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!settingsQuery.data?.vachatReady || vachatDisconnect.isPending}
                  onClick={() => vachatDisconnect.mutate()}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : !settingsQuery.data?.enabled ? (
        <div className="space-y-3">
          <SupportTips tips={OFF_TIPS} />
          <EmptyState
            icon={Headphones}
            title="Support is off"
            description={
              settingsQuery.data?.mode === "merchant_vachat" && !settingsQuery.data?.vachatReady
                ? "Connect your WhatsApp key, or switch to PostBus WhatsApp in Settings."
                : settingsQuery.data?.globalSupport || settingsQuery.data?.vachatReady
                  ? "Turn it on in Settings. New customer WhatsApp messages will show in Inbox."
                  : "Ask PostBus to enable PostBus WhatsApp, or connect your own WhatsApp in Settings."
            }
            action={
              canSettings ? (
                <Button onClick={() => setView("settings")}>Open settings</Button>
              ) : null
            }
          />
        </div>
      ) : view === "tickets" ? (
        <div className="space-y-3">
        <SupportTips
          tips={[
            { title: "What a ticket is", text: "One customer request — cancel, return, refund, or delivery." },
            { title: "Status", text: "Open, in progress, waiting on the customer, or waiting on you." },
            { title: "Next step", text: "Reply in Inbox. Change status in the chat Details panel." },
          ]}
        />
        <div className="rounded-2xl border border-border bg-card">
          {(ticketsQuery.data?.items ?? []).map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left last:border-0"
              onClick={() => {
                setView("inbox");
              }}
            >
              <span className="font-medium">{ticket.publicNumber}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  {SUPPORT_TICKET_CATEGORY_LABELS[ticket.category as SupportTicketCategory] ?? ticket.category}
                </span>
                <Badge>
                  {SUPPORT_TICKET_STATUS_LABELS[ticket.status as SupportTicketStatus] ?? ticket.status}
                </Badge>
              </span>
            </button>
          ))}
          {!ticketsQuery.data?.items?.length ? (
            <p className="p-6 text-sm text-muted">No tickets yet. A ticket is created when a customer starts a chat or makes a request.</p>
          ) : null}
        </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
        {!items.length ? <SupportTips tips={INBOX_TIPS} /> : null}
        <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
          <div className={cn("border-r border-border", mobilePane === "chat" && "hidden lg:block")}>
            <div className="space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
                <Input
                  value={searchInput}
                  placeholder="Name, phone, ticket, or order"
                  className="pl-8 pr-8"
                  aria-label="Search conversations"
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                    setSelectedId(null);
                  }}
                />
                {searchInput ? (
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded p-0.5 text-muted hover:text-foreground"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                      setSelectedId(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((item) => (
                  <Button key={item} size="sm" variant={filter === item ? "primary" : "secondary"} className="h-7" onClick={() => setFilter(item)}>
                    {FILTER_LABELS[item]}
                  </Button>
                ))}
              </div>
              <Select value={category || "all"} onValueChange={(value) => setCategory(value === "all" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {SUPPORT_TICKET_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>{SUPPORT_TICKET_CATEGORY_LABELS[item]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[calc(100svh-16rem)] overflow-y-auto">
              {items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={cn(
                    "w-full border-b border-border px-3 py-3 text-left",
                    selectedId === row.id && "bg-rose-50"
                  )}
                  onClick={async () => {
                    setSelectedId(row.id);
                    setMobilePane("chat");
                    await api(`/api/v1/support/conversations/${row.id}/read`, { method: "POST" });
                    void queryClient.invalidateQueries({ queryKey: ["support"] });
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{row.customerName || `+91 ${row.phoneDigits}`}</p>
                    {row.unreadCount > 0 ? <Badge variant="brand">{row.unreadCount}</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted">{row.lastMessagePreview || "No messages yet"}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span>{row.channelKind === "merchant_vachat" ? "Your number" : "PostBus WhatsApp"}</span>
                    {row.lastMessageAt ? <span>{formatDistanceToNow(new Date(row.lastMessageAt), { addSuffix: true })}</span> : null}
                    {row.ticket ? <span>{SUPPORT_TICKET_STATUS_LABELS[row.ticket.status]}</span> : null}
                    {row.ticket ? <span>{SUPPORT_TICKET_PRIORITY_LABELS[row.ticket.priority as keyof typeof SUPPORT_TICKET_PRIORITY_LABELS]}</span> : null}
                  </div>
                </button>
              ))}
              {conversationsQuery.isFetching ? (
                <p className="flex items-center gap-2 p-6 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </p>
              ) : !items.length ? (
                <p className="p-6 text-sm text-muted">
                  {searchQuery
                    ? "No chats match that search. Try a name, phone, ticket, or order number."
                    : "No chats yet. They appear here when a customer messages WhatsApp."}
                </p>
              ) : null}
            </div>
          </div>

          <div className={cn("flex min-h-[28rem] flex-col", mobilePane === "list" && "hidden lg:flex")}>
            {selected ? (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <button type="button" className="lg:hidden text-sm text-brand" onClick={() => setMobilePane("list")}>Back</button>
                    <p className="font-semibold">{selected.customerName || `+91 ${selected.phoneDigits}`}</p>
                    <p className="text-xs text-muted">
                      {selected.channelKind === "merchant_vachat" ? "Your number" : "PostBus WhatsApp"}
                      {" · "}
                      {windowOpen
                        ? `You can reply now · ${remainingLabel(context?.conversation?.windowRemainingMs ?? 0)}`
                        : "24-hour window closed · Send an approved template"}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" className="xl:hidden" onClick={() => setContextOpen(true)}>Details</Button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto bg-surface-soft p-4">
                  {(messagesQuery.data?.items ?? []).map((message) => (
                    <div key={message.id} className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", message.direction === "outbound" ? "ml-auto bg-brand text-white" : "bg-card")}>
                      <p>{message.body || (message.contentType !== "text" ? `[${message.contentType}]` : "")}</p>
                      <p className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", message.direction === "outbound" ? "text-white/80" : "text-muted")}>
                        {formatDate(message.createdAt, true)}
                        {message.direction === "outbound" ? (
                          message.status === "read" ? <CheckCheck className="size-3" /> : <Check className="size-3" />
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border p-3">
                  {windowOpen ? (
                    <div className="flex gap-2">
                      <Textarea
                        className="min-h-[72px]"
                        placeholder={canReply ? "Write a WhatsApp reply" : "You can view chats, not reply."}
                        value={draft}
                        disabled={!canReply || sendMutation.isPending}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <Button disabled={!canReply || !draft.trim() || sendMutation.isPending} onClick={() => sendMutation.mutate()}>
                        {sendMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-muted">The 24-hour reply window is closed. Send an approved template to reach this customer again.</p>
                      <div className="flex gap-2">
                        <Select value={templateName} onValueChange={setTemplateName}>
                          <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                          <SelectContent>
                            {(templatesQuery.data?.items ?? []).map((item) => (
                              <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button disabled={!canReply || !templateName || templateMutation.isPending} onClick={() => templateMutation.mutate()}>
                          Send template
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                icon={Paperclip}
                title="Open a chat"
                description="Pick a customer on the left. You will see their messages, order, and ticket here."
              />
            )}
          </div>

          <aside className="hidden overflow-y-auto border-l border-border xl:block">{contextPanel}</aside>
        </div>
        </div>
      )}

      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Customer, order & ticket</DialogTitle></DialogHeader>
          {contextPanel}
        </DialogContent>
      </Dialog>
    </div>
  );
}
