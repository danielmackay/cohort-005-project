import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { NotificationCategory } from "~/lib/notifications";

/** The anchor the bell's gear links to. */
export const NOTIFICATION_SETTINGS_ID = "notifications";

/** The intent the settings action dispatches a switch flip on. */
export const SET_NOTIFICATION_PREFERENCE = "set-notification-preference";

const CATEGORY_TEXT: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  [NotificationCategory.RefundRequestUpdates]: {
    label: "Refund Request updates",
    description: "When we receive, approve or decline your refund requests.",
  },
  [NotificationCategory.OpenRefundRequests]: {
    label: "Open Refund Requests",
    description: "When a buyer asks for a refund that needs a decision.",
  },
  [NotificationCategory.SeatClaims]: {
    label: "Seat claims",
    description: "When someone claims a seat on your team licence.",
  },
  [NotificationCategory.Enrollments]: {
    label: "Enrollments",
    description: "When a student enrolls in one of your courses.",
  },
  [NotificationCategory.DiscussionQuestions]: {
    label: "Discussion Questions",
    description: "When a student asks a question on one of your lessons.",
  },
  [NotificationCategory.DiscussionReplies]: {
    label: "Discussion Replies",
    description: "When someone replies to a question you asked.",
  },
};

export type NotificationSettingsCardProps = {
  settings:
    | { ok: true; settings: { category: NotificationCategory; enabled: boolean }[] }
    | { ok: false; error: string };
};

export function NotificationSettingsCard({
  settings,
}: NotificationSettingsCardProps) {
  return (
    <Card id={NOTIFICATION_SETTINGS_ID} className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what shows up in your Notification Feed.
        </p>
      </CardHeader>
      <CardContent>
        {settings.ok ? (
          <ul className="divide-y">
            {settings.settings.map((setting) => (
              <PreferenceRow
                key={setting.category}
                category={setting.category}
                enabled={setting.enabled}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-destructive">{settings.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function isActionFailure(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function PreferenceRow({
  category,
  enabled,
}: {
  category: NotificationCategory;
  enabled: boolean;
}) {
  // Keyed per category so each switch saves on its own.
  const fetcher = useFetcher({ key: `notification-preference-${category}` });
  const { label, description } = CATEGORY_TEXT[category];
  const switchId = `notification-${category}`;

  // Optimistic: while the save is in flight, show what was asked for. A failed
  // save skips revalidation, so the switch falls back to the loader's value,
  // which is the one still stored.
  const pending = fetcher.formData?.get("enabled");
  const checked = pending === undefined || pending === null
    ? enabled
    : pending === "true";

  useEffect(() => {
    if (fetcher.state === "idle" && isActionFailure(fetcher.data)) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-1">
        <Label htmlFor={switchId}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={(next) =>
          fetcher.submit(
            {
              intent: SET_NOTIFICATION_PREFERENCE,
              category,
              enabled: String(next),
            },
            { method: "post", action: "/settings" }
          )
        }
      />
    </li>
  );
}
