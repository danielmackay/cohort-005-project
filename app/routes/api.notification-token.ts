import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { getFeedConnection } from "~/lib/notifications.server";
import { getCurrentUserId } from "~/lib/session";

// A fresh Notification Feed token for the signed-in user, fetched by the
// browser shortly before its current one expires.
export async function loader({ request, url }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel", { status: 401 });
  }

  // The feed asks on behalf of the user it was opened for. If the session has
  // since switched to someone else (another tab), that feed is stale and gets
  // replaced on its next loader run, so don't hand it another user's token.
  const forUserId = url.searchParams.get("userId");
  if (forUserId !== String(currentUserId)) {
    throw data("The signed-in user has changed", { status: 409 });
  }

  const connection = await getFeedConnection(currentUserId);
  if (!connection) {
    throw data("Notifications aren't available", { status: 503 });
  }
  return { userToken: connection.userToken };
}
