import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import {
  courses,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundState,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  approveRefundRequest,
  declineRefundRequest,
  markRefundFailed,
  markRefundIssued,
} from "~/lib/refunds.server";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

const adminRefundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    reason: z
      .string()
      .trim()
      .min(1, "Tell the student why their Refund Request was declined.")
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
  z.object({
    intent: z.literal("mark-issued"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("mark-failed"),
    refundRequestId: z.coerce.number().int(),
  }),
]);

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  const user = db.select().from(users).where(eq(users.id, currentUserId)).get();
  if (!user || user.role !== UserRole.Admin) {
    throw data("Only Admins can decide Refund Requests.", { status: 403 });
  }
  return user;
}

function selectRefundRows() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      amountRefunded: refunds.amountRefunded,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      studentId: users.id,
      studentName: users.name,
      studentEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id));
}

/** How much of the course the student has used, to judge against the refund rules. */
function getCourseUsage(studentId: number, courseId: number) {
  const lessonIds = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  if (lessonIds.length === 0) {
    return { lessonsCompleted: 0, lessonCount: 0, secondsWatched: 0 };
  }

  const completed = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, studentId),
        inArray(lessonProgress.lessonId, lessonIds),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .get();

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, studentId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return {
    lessonsCompleted: completed?.count ?? 0,
    lessonCount: lessonIds.length,
    secondsWatched: furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    ),
  };
}

function getRefundRequestForEmail(refundRequestId: number) {
  return selectRefundRows().where(eq(refunds.id, refundRequestId)).get();
}

/**
 * The decision email the student gets. There is no mail transport wired up
 * yet, so the built message goes to the server log.
 */
function buildRefundDecisionEmail(input: {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  amount: number;
  decision: "approved" | "declined";
  declineReason?: string;
}) {
  const body =
    input.decision === "approved"
      ? [
          `We've approved your refund request for "${input.courseTitle}".`,
          `We're sending back ${formatPrice(input.amount)}, the full amount you paid. Your access to the course has ended.`,
          "If you buy the course again later, your progress will be waiting for you.",
        ]
      : [
          `We've looked at your refund request for "${input.courseTitle}" and can't approve it.`,
          "",
          input.declineReason ?? "",
          "",
          "You still have full access to the course.",
        ];

  return {
    to: input.studentEmail,
    subject: `Refund Request ${input.decision} — ${input.courseTitle}`,
    body: [
      `Hi ${input.studentName},`,
      "",
      ...body,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const openRequests = selectRefundRows()
    .where(eq(refunds.status, RefundStatus.Open))
    .orderBy(asc(refunds.requestedAt))
    .all()
    .map((row) => ({
      ...row,
      usage: getCourseUsage(row.studentId, row.courseId),
    }));

  const pendingRefunds = selectRefundRows()
    .where(
      and(
        eq(refunds.status, RefundStatus.Approved),
        eq(refunds.refundState, RefundState.Pending)
      )
    )
    .orderBy(asc(refunds.resolvedAt))
    .all();

  return { openRequests, pendingRefunds };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminRefundActionSchema);

  if (!parsed.success) {
    throw data(Object.values(parsed.errors)[0] ?? "Invalid input.", {
      status: 400,
    });
  }

  const { intent, refundRequestId } = parsed.data;

  if (intent === "mark-issued" || intent === "mark-failed") {
    const mark = intent === "mark-issued" ? markRefundIssued : markRefundFailed;
    const result = mark(db, refundRequestId, admin.id);
    if (!result.ok) throw data(result.error, { status: 409 });
    return {
      success:
        intent === "mark-issued"
          ? "Refund marked as Issued."
          : "Refund marked as Failed.",
    };
  }

  const result =
    intent === "approve"
      ? approveRefundRequest(db, refundRequestId, admin.id)
      : declineRefundRequest(db, refundRequestId, admin.id, parsed.data.reason);

  if (!result.ok) throw data(result.error, { status: 409 });

  const decided = getRefundRequestForEmail(refundRequestId);
  if (decided) {
    const email = buildRefundDecisionEmail({
      studentName: decided.studentName,
      studentEmail: decided.studentEmail,
      courseTitle: decided.courseTitle,
      amount: decided.amountPaid,
      decision: intent === "approve" ? "approved" : "declined",
      declineReason: intent === "decline" ? parsed.data.reason : undefined,
    });
    console.log(
      `[email] to=${email.to} subject=${email.subject}\n${email.body}`
    );
  }

  return {
    success:
      intent === "approve"
        ? "Refund Request approved."
        : "Refund Request declined.",
  };
}

function useSuccessToast(fetcher: ReturnType<typeof useFetcher<typeof action>>) {
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      toast.success(fetcher.data.success);
    }
  }, [fetcher.state, fetcher.data]);
}

function formatHours(seconds: number) {
  const hours = seconds / 3600;
  return `${hours.toFixed(1)} h`;
}

// The same on server and client, so it can't cause a hydration mismatch.
function formatDate(iso: string | null) {
  return iso ? iso.slice(0, 10) : "—";
}

type OpenRequest = Route.ComponentProps["loaderData"]["openRequests"][number];
type PendingRefund =
  Route.ComponentProps["loaderData"]["pendingRefunds"][number];

function OpenRequestCard({ request }: { request: OpenRequest }) {
  const fetcher = useFetcher<typeof action>();
  const [declining, setDeclining] = useState(false);
  const busy = fetcher.state !== "idle";
  useSuccessToast(fetcher);

  const { lessonsCompleted, lessonCount, secondsWatched } = request.usage;

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium">
            {request.studentName}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {request.studentEmail}
            </span>
          </p>
          <Link
            to={`/courses/${request.courseSlug}`}
            className="text-sm text-primary hover:underline"
          >
            {request.courseTitle}
          </Link>
        </div>
        <p className="text-sm font-medium">{formatPrice(request.amountPaid)}</p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Bought</dt>
          <dd>{formatDate(request.purchasedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{formatDate(request.requestedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lessons completed</dt>
          <dd>
            {lessonsCompleted} of {lessonCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Watched</dt>
          <dd>{formatHours(secondsWatched)}</dd>
        </div>
      </dl>

      <p className="mt-3 rounded bg-muted p-3 text-sm">{request.reason}</p>

      {declining ? (
        <fetcher.Form method="post" className="mt-3 space-y-2">
          <input type="hidden" name="intent" value="decline" />
          <input type="hidden" name="refundRequestId" value={request.id} />
          <Textarea
            name="reason"
            required
            maxLength={1000}
            placeholder="Why is this being declined? The student will see this."
            aria-label="Reason for declining"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Declining..." : "Decline"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeclining(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <div className="mt-3 flex gap-2">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="approve" />
            <input type="hidden" name="refundRequestId" value={request.id} />
            <Button type="submit" disabled={busy}>
              {busy ? "Approving..." : "Approve"}
            </Button>
          </fetcher.Form>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeclining(true)}
            disabled={busy}
          >
            Decline…
          </Button>
        </div>
      )}
    </div>
  );
}

function PendingRefundRow({ refund }: { refund: PendingRefund }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  useSuccessToast(fetcher);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
      <div>
        <p className="font-medium">
          {refund.studentName} · {refund.courseTitle}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatPrice(refund.amountRefunded ?? refund.amountPaid)} · approved{" "}
          {formatDate(refund.resolvedAt)}
        </p>
      </div>
      <fetcher.Form method="post" className="flex gap-2">
        <input type="hidden" name="refundRequestId" value={refund.id} />
        <Button
          type="submit"
          name="intent"
          value="mark-issued"
          disabled={busy}
        >
          Mark Issued
        </Button>
        <Button
          type="submit"
          name="intent"
          value="mark-failed"
          variant="outline"
          disabled={busy}
        >
          Mark Failed
        </Button>
      </fetcher.Form>
    </div>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { openRequests, pendingRefunds } = loaderData;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ReceiptText className="size-6" /> Refund Requests
        </h1>
        <p className="mt-1 text-muted-foreground">
          Approving ends the student&apos;s access straight away and creates a
          Pending Refund for the full amount. Decisions are final.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            Open Refund Requests ({openRequests.length})
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {openRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Refund Requests are waiting on a decision.
            </p>
          ) : (
            openRequests.map((request) => (
              <OpenRequestCard key={request.id} request={request} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            Pending Refunds ({pendingRefunds.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Approved, but the money hasn&apos;t been confirmed as sent yet.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingRefunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Refunds are waiting to be marked Issued or Failed.
            </p>
          ) : (
            pendingRefunds.map((refund) => (
              <PendingRefundRow key={refund.id} refund={refund} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
