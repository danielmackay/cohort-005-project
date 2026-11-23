import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import { setCurrentUserId, setDevCountry } from "~/lib/session";
import { createCourseAccess, type Viewer } from "../index.server";
import { getViewer } from "../viewer.server";

let db: TestDb;
let access: ReturnType<typeof createCourseAccess>;
let student: typeof schema.users.$inferSelect;
let instructor: typeof schema.users.$inferSelect;
let otherInstructor: typeof schema.users.$inferSelect;
let platformAdmin: typeof schema.users.$inferSelect;
let course: typeof schema.courses.$inferSelect;
let otherCourse: typeof schema.courses.$inferSelect;
let moduleId: number;
let lessonId: number;
let otherModuleId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  access = createCourseAccess(db);
  const base = seedBaseData(db);
  student = base.user;
  instructor = base.instructor;
  course = base.course;
  otherInstructor = addUser("Olive Other", UserRole.Instructor);
  platformAdmin = addUser("Pat Admin", UserRole.Admin);
  otherCourse = addCourse(otherInstructor.id, base.category.id, "other-course");
  moduleId = addModule(course.id);
  lessonId = addLesson(moduleId);
  otherModuleId = addModule(otherCourse.id);
  otherLessonId = addLesson(otherModuleId);
});

// ─── Fixtures ───

function addUser(name: string, role: UserRole) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

function addCourse(instructorId: number, categoryId: number, slug: string) {
  return db
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: slug,
      salesCopy: markdown(slug),
      instructorId,
      categoryId,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function addModule(courseId: number) {
  return db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get().id;
}

function addLesson(inModuleId: number) {
  return db
    .insert(schema.lessons)
    .values({ moduleId: inModuleId, title: "Lesson", position: 1 })
    .returning()
    .get().id;
}

function enroll(userId: number, courseId = course.id) {
  db.insert(schema.enrollments).values({ userId, courseId }).run();
}

function buy(userId: number, country: string | null, courseId = course.id) {
  db.insert(schema.purchases)
    .values({ userId, courseId, amountPaid: 2500, country })
    .run();
}

function pricePppCourse(price = 7900, pppEnabled = true) {
  db.update(schema.courses)
    .set({ price, pppEnabled })
    .where(eq(schema.courses.id, course.id))
    .run();
}

function viewer(userId: number | null, country: string | null = null): Viewer {
  return { userId, country };
}

function statusOf(run: () => unknown): number {
  try {
    run();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "init" in error &&
      typeof error.init === "object" &&
      error.init !== null &&
      "status" in error.init &&
      typeof error.init.status === "number"
    ) {
      return error.init.status;
    }
    throw error;
  }
  throw new Error("Expected the call to throw a data() response");
}

// ─── Lesson access ───

describe("lesson", () => {
  it("denies a signed-out visitor", () => {
    expect(access.lesson(viewer(null), { lessonId })).toEqual({
      courseId: course.id,
      granted: false,
      reason: "signed-out",
    });
  });

  it("treats a session for a deleted user as signed out", () => {
    expect(access.lesson(viewer(9999), { lessonId })).toMatchObject({
      granted: false,
      reason: "signed-out",
    });
  });

  it("denies a Student without an Enrollment", () => {
    expect(access.lesson(viewer(student.id), { lessonId })).toEqual({
      courseId: course.id,
      granted: false,
      reason: "not-enrolled",
      userId: student.id,
    });
  });

  it("grants an Enrolled Student", () => {
    enroll(student.id);
    expect(access.lesson(viewer(student.id), { lessonId })).toEqual({
      courseId: course.id,
      granted: true,
      userId: student.id,
      isCourseStaff: false,
      enrolled: true,
    });
  });

  it("denies with a PPP Block when a discounted buyer is in another country", () => {
    pricePppCourse();
    enroll(student.id);
    buy(student.id, "IN");
    expect(access.lesson(viewer(student.id, "US"), { lessonId })).toEqual({
      courseId: course.id,
      granted: false,
      reason: "ppp-blocked",
      userId: student.id,
      purchaseCountry: "IN",
      currentCountry: "US",
    });
  });

  it.each([
    ["a full-price purchase", "US", 7900, true],
    ["PPP turned off", "IN", 7900, false],
    ["a free course", "IN", 0, true],
  ] as const)(
    "grants a buyer in another country with %s",
    (_label, purchaseCountry, price, pppEnabled) => {
      pricePppCourse(price, pppEnabled);
      enroll(student.id);
      buy(student.id, purchaseCountry);
      expect(
        access.lesson(viewer(student.id, "GB"), { lessonId })
      ).toMatchObject({ granted: true });
    }
  );

  it("grants a discounted buyer in the country they bought in", () => {
    pricePppCourse();
    enroll(student.id);
    buy(student.id, "IN");
    expect(
      access.lesson(viewer(student.id, "IN"), { lessonId })
    ).toMatchObject({ granted: true });
  });

  it.each([
    ["the course's Instructor", () => instructor],
    ["a Platform Admin", () => platformAdmin],
  ])(
    "grants %s as Course Staff without an Enrollment, from any country",
    (_label, who) => {
      pricePppCourse();
      buy(who().id, "IN");
      expect(access.lesson(viewer(who().id, "US"), { lessonId })).toEqual({
        courseId: course.id,
        granted: true,
        userId: who().id,
        isCourseStaff: true,
        enrolled: false,
      });
    }
  );

  it("does not treat another course's Instructor as Course Staff", () => {
    expect(
      access.lesson(viewer(otherInstructor.id), { lessonId })
    ).toMatchObject({ granted: false, reason: "not-enrolled" });
  });

  it("works out the course from the lesson when none is given", () => {
    enroll(student.id, otherCourse.id);
    expect(
      access.lesson(viewer(student.id), { lessonId: otherLessonId })
    ).toMatchObject({ courseId: otherCourse.id, granted: true });
  });

  it("404s a lesson from another course, before any access decision", () => {
    expect(
      statusOf(() =>
        access.lesson(viewer(null), {
          lessonId: otherLessonId,
          courseId: course.id,
        })
      )
    ).toBe(404);
  });

  it("404s a lesson that doesn't exist", () => {
    expect(statusOf(() => access.lesson(viewer(null), { lessonId: 9999 }))).toBe(
      404
    );
  });
});

describe("requireLesson", () => {
  it("throws 401 when signed out", () => {
    expect(statusOf(() => access.requireLesson(viewer(null), { lessonId }))).toBe(
      401
    );
  });

  it("throws 403 without an Enrollment", () => {
    expect(
      statusOf(() => access.requireLesson(viewer(student.id), { lessonId }))
    ).toBe(403);
  });

  it("throws 403 under a PPP Block", () => {
    pricePppCourse();
    enroll(student.id);
    buy(student.id, "IN");
    expect(
      statusOf(() =>
        access.requireLesson(viewer(student.id, "US"), { lessonId })
      )
    ).toBe(403);
  });

  it("returns the grant when allowed", () => {
    enroll(student.id);
    expect(
      access.requireLesson(viewer(student.id), {
        lessonId,
        courseId: course.id,
      })
    ).toEqual({
      courseId: course.id,
      userId: student.id,
      isCourseStaff: false,
      enrolled: true,
    });
  });
});

// ─── Course Staff ───

describe("requireCourseStaff", () => {
  it("throws 401 when signed out", () => {
    expect(
      statusOf(() =>
        access.requireCourseStaff(viewer(null), { courseId: course.id })
      )
    ).toBe(401);
  });

  it("throws 404 for a missing course before deciding Course Staff", () => {
    expect(
      statusOf(() =>
        access.requireCourseStaff(viewer(student.id), { courseId: 9999 })
      )
    ).toBe(404);
  });

  it.each([
    ["module", () => ({ moduleId: otherModuleId })],
    ["lesson", () => ({ lessonId: otherLessonId })],
  ])("throws 404 for a %s from another course", (_label, extra) => {
    expect(
      statusOf(() =>
        access.requireCourseStaff(viewer(instructor.id), {
          courseId: course.id,
          ...extra(),
        })
      )
    ).toBe(404);
  });

  it.each([
    ["a Student", () => student],
    ["another course's Instructor", () => otherInstructor],
  ])("throws 403 for %s", (_label, who) => {
    expect(
      statusOf(() =>
        access.requireCourseStaff(viewer(who().id), { courseId: course.id })
      )
    ).toBe(403);
  });

  it("allows the course's Instructor, with a module and lesson in the course", () => {
    expect(
      access.requireCourseStaff(viewer(instructor.id), {
        courseId: course.id,
        moduleId,
        lessonId,
      })
    ).toEqual({ userId: instructor.id, isPlatformAdmin: false });
  });

  it("allows a Platform Admin on any course", () => {
    expect(
      access.requireCourseStaff(viewer(platformAdmin.id), {
        courseId: course.id,
      })
    ).toEqual({ userId: platformAdmin.id, isPlatformAdmin: true });
  });
});

// ─── Platform-wide checks ───

describe("requireUserId", () => {
  it("throws 401 when signed out, else returns the id", () => {
    expect(statusOf(() => access.requireUserId(viewer(null)))).toBe(401);
    expect(access.requireUserId(viewer(student.id))).toBe(student.id);
  });
});

describe("requireInstructorOrAdmin", () => {
  it("throws 403 for a Student", () => {
    expect(
      statusOf(() => access.requireInstructorOrAdmin(viewer(student.id)))
    ).toBe(403);
  });

  it("allows an Instructor and a Platform Admin", () => {
    expect(access.requireInstructorOrAdmin(viewer(instructor.id))).toMatchObject(
      { userId: instructor.id, isAdmin: false }
    );
    expect(
      access.requireInstructorOrAdmin(viewer(platformAdmin.id))
    ).toMatchObject({ userId: platformAdmin.id, isAdmin: true });
  });
});

// ─── Request → viewer ───

describe("getViewer", () => {
  const URL = "http://localhost:3000/";

  function cookieFrom(setCookie: string) {
    return setCookie.split(";")[0];
  }

  it("is signed out with no country for a bare request", async () => {
    expect(await getViewer(new Request(URL))).toEqual({
      userId: null,
      country: null,
    });
  });

  it("reads the session user and the CF-IPCountry header", async () => {
    const cookie = cookieFrom(await setCurrentUserId(new Request(URL), 42));
    const request = new Request(URL, {
      headers: { Cookie: cookie, "CF-IPCountry": "in" },
    });
    expect(await getViewer(request)).toEqual({ userId: 42, country: "IN" });
  });

  it("prefers the dev country override over CF-IPCountry", async () => {
    const signedIn = cookieFrom(await setCurrentUserId(new Request(URL), 42));
    const withCountry = cookieFrom(
      await setDevCountry(
        new Request(URL, { headers: { Cookie: signedIn } }),
        "BR"
      )
    );
    const request = new Request(URL, {
      headers: { Cookie: withCountry, "CF-IPCountry": "US" },
    });
    expect(await getViewer(request)).toEqual({ userId: 42, country: "BR" });
  });
});
