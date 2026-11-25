# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string`. The cast
is a lie the type checker believes.

## Do not write `any`, and do not write `!`

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.

## Arrange tests through the module under test

Test setup calls the module's own functions. When the function you need does
not exist, add it to the module rather than inserting rows directly, so a
change to how the module stores its data leaves its tests alone.

## Import a module only through its entry points

A module in `app/modules/` exposes its root files and hides everything in
its subfolders. Import `~/modules/<name>/index.server`, never
`~/modules/<name>/lib/...`, and have the module's own tests do the same. A
deep import welds the caller to an implementation the module is free to
change. See [app/modules/README.md](./app/modules/README.md).

## A route does not query data a module owns

Once a module owns a feature's data, the route asks the module for it and
does not import `~/db` or `drizzle-orm` itself. The instructor analytics
route gets everything from `instructorAnalytics`. A query in the loader
splits the feature's rules across two files, and the module's tests stop
covering what the page shows.

`npm run lint:boundaries` enforces both rules where it can. It cannot see
every case, so follow them where it is silent.

## Keep every file under 500 lines

Count the lines before you commit. A file over 500 lines gets split, whatever
is in it — source, test, or Markdown. Lockfiles, migrations and generated
snapshots are the only exceptions.

## Wrap related writes in a transaction

Two writes that must both land, or neither, go in a transaction. If the second
one fails and the first stayed, you have invented a state nothing knows how to
read. (The refund bug: the refund was approved, the enrollment was never
ended, and the learner kept the course.)

## Two-space indentation

Not four, not tabs.

## Check permission in the action, not only the loader

A loader guard does not protect an action. They are separate requests. For a
week anybody who was signed in could approve a refund by posting to
`/admin/refunds`.

## Name a boolean so it reads as a question

`isPublished`, `hasSeats`, `canRefund`. Not `published`, `seats`, `refund`.

## Every image has alt text

Decorative images take `alt=""`, not no attribute.

## Avoid the N+1

One query in a loop is N+1 queries. Use a join, or one query with an `IN`.

## Semicolons at the end of every statement

Do not rely on automatic semicolon insertion.

## Never trust a number that came from a form

`Number("")` is `0`, and `0` is a valid id in most schemas. An empty
`lessonId` once opened lesson 0 for every learner.

## Money is stored in integer cents.

Never a float. Floats cannot hold a tenth. Regional prices came out as
`19.990000000000002` until we changed this.

### Lines wrap at 80 characters

## Don't leave commented-out code

Git has it. Delete it.

## Use the design tokens

Never a raw hex value. `text-muted-foreground`, not `#6b7280`.

## Timestamps are stored as ISO strings in UTC

A local time in a column is a bug waiting for somebody in another country. The
refund window closed a day early for learners in Sydney before this.

## Use `===`, never `==`

`==` coerces, and the coercion table is not something anybody remembers.

## Never put a secret in the client bundle

Anything the browser can read is public.

## Keep a function under fifty lines

If it is longer, it is doing more than one thing.

## Imports are sorted: packages, then aliases, then relative

Within each group, alphabetically.

## Every input has a label

## Read lesson progress through `progressCache`

Do not query the progress table from a route. `progressCache` holds the
learner's progress per lesson and falls back to the progress service when it
is cold.

## Paginate anything that can grow

A query with no limit is fine on a seeded database and fatal on a real one.
If the row count is a function of how long the product has been alive, add a
limit. The instructor's students page timed out on the first big course.

## Prefer `interface` for object shapes, `type` for unions

## Catch the narrowest thing you can

A bare `catch` that swallows everything hides the bug you are about to spend
a day on.

## Every item in a list gets a stable key

The index of an item is not a key. When the list is reordered, every row
below the change is rebuilt, and anything the row was holding is lost. Use
the row's id. (Reordering modules used to drop the half-typed lesson title.)

## Trailing commas in multi-line literals

The diff is smaller when the next line is added.

## Soft-delete anything a person can point at

If another row references it, or a person has a link to it, do not delete it.
Mark it deleted and filter it out on read. Deleting a lesson used to take the
learners' notes and bookmarks with it.

## Do not abbreviate

`request`, not `req`. `error`, not `e`. The only exceptions are `id` and `url`,
which are longer written out.

## Do not catch an error only to re-throw it unchanged

## Select the columns you need, never all of them

`select *` reads pages you do not want and ties the caller to the shape of
the table. Name the columns.

## No `console.log` left in a committed file

`console.error` in a catch block is fine.

## never log a secret

## Double quotes for strings

Single quotes only inside a double-quoted string.

## The branch name matches the ticket

## Use semantic elements

A `div` with an `onClick` is a button that nobody can tab to.

## Index every foreign key

A foreign key without an index is a table scan on every join. Add the index
in the same change that adds the key.

### No trailing whitespace

Strip it before you commit.

## Also

- Every file ends with a newline.
- Do not set a positive `tabIndex`.
- Squash before landing.
- Throw `Error`, never a string.
- Strings go in double quotes, please — not single.

## Inject the clock

A function that calls `Date.now()` cannot be tested at a fixed moment. Take
the time as an argument. The refund window tests failed every night at
midnight until we did this.

## Migrations are forward-only

Never edit a migration that has been applied. Write another one.

## Use `const` unless you reassign

If you reassign, use `let`. Never `var`.

## Escape anything a person typed before you render it as HTML

## Effects declare every value they read

If an effect reads a value, that value is in the dependency array. Leaving it
out is a bug that will not show up until the value changes.

## A commit message says why

The diff already says what.

## Default exports only for route modules

Everything else is a named export.

## Log the error, not just the message

The stack is the useful part.

### Component props are a `type`

Write `type Props = { … }`, not `interface Props`.

## Never build a query by joining strings

Parameterise. String concatenation is how injection gets in, and it is also
how a quote in somebody's name takes the page down.

## No inline styles except for a computed value

A width that is a percentage of progress is fine. A colour is not.

## One export per line

Do not put two exported symbols on one line.

## Do not commit a lockfile change you did not intend

## Enumerations live in the schema file

A status string that the code compares against is an enum in `app/db/schema.ts`,
not a literal repeated in six places. Refund status was `"pending"` in four
files and `"Pending"` in one.

## No more than three parameters

Past three, take an object.

## Prefer arrow functions for callbacks

`items.map((item) => item.id)`, not `items.map(function (item) { … })`.

## Do not commit a skipped test

## Do not read from the database in a loop

We got bitten by this in the notes loader: one query per lesson, forty lessons
per course.

## Keep the heading levels in order

## Rebase, do not merge, before you open a pull request

## Do not write a type that the compiler can infer

`const count: number = items.length` says nothing the compiler did not know.

## Set `rel="noopener noreferrer"` on every external link

## No TODO without a name and a date

`// TODO(matt, 2026-03-01): …`. A TODO with nobody's name on it is a wish.

## Do not commit generated files

## Do not nest more than three levels

## Run the checks before you push
