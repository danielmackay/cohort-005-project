import { db as appDb } from "~/db";
import {
  getInstructorAnalytics as computeInstructorAnalytics,
  type AnalyticsViewer,
  type Db,
  type InstructorAnalytics,
} from "./lib/instructor-analytics.server";

// ─── Instructor Analytics ───
// Every figure on the instructor analytics page, from one call. The module
// owns its database access: callers hand over who is looking, the page's raw
// search params and the time, and never touch the database themselves.

export type {
  AnalyticsViewer,
  CourseCountryRevenue,
  CourseFunnel,
  CourseProgressSummary,
  Db,
  FunnelLesson,
  InstructorAnalytics,
  QuizPassRate,
  RefundExposure,
  RevenueSeries,
} from "./lib/instructor-analytics.server";

/**
 * Every figure on the instructor analytics page.
 *
 * Never throws on bad params: an unknown range, tab, instructor or course
 * falls back to its default. `now` is the only clock read.
 *
 * `database` defaults to the app's database. It is a parameter so tests can
 * run the same rules against an in-memory database through this entry point.
 */
export function getInstructorAnalytics(
  viewer: AnalyticsViewer,
  params: URLSearchParams,
  now: Date,
  database: Db = appDb
): InstructorAnalytics {
  return computeInstructorAnalytics(database, viewer, params, now);
}
