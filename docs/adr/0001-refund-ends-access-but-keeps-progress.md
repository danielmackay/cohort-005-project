# A Refund ends access but keeps progress

When an Admin approves a Refund Request, the student loses access to the course straight away, without waiting for the Refund to be Issued. Their progress (lesson progress, quiz attempts, watch history, completion) and their single Enrollment are kept, not deleted. The Enrollment has a status (at least active and refunded), and approval moves it to refunded, so one record answers "does this student have access?". If they buy the course again, the same Enrollment goes back to active and their progress comes back. A student gets at most one Refund per course, so a course bought again can't be refunded again.

## Considered Options

- **Delete progress on approval**: a clean break, but it can't be undone, and it wipes the watch history that the refund usage limits (14 days, 2 hours watched, 50% complete) rely on. That would let a student watch, get refunded, buy again and start from zero.
- **Keep progress visible but read-only**: shows a refunded course on the student's dashboard that they can no longer open.
- **Revoke access only once the Refund is Issued**: the decision is the approval. Tying access to the money would leave a student with a Failed Refund holding a course they asked to give back.
- **Create a new Enrollment on repurchase**: rejected in favour of one Enrollment per student per course, so a student's history with a course stays on one record.
- **Work out refunded status from Refund Requests on every access check**: avoids storing the same fact twice, but makes every access check join through purchases and Refund Requests. A status on the Enrollment makes access a single-record lookup.

## Consequences

- Course access checks must check that the Enrollment is active, not just that it exists.
- Approving a Refund Request and moving the Enrollment to refunded must happen together, or the two can disagree.
- A refunded student's rating stops counting towards the course average, and they drop out of the instructor's enrollment numbers. Their comments stay.
- Unclaimed Seat Coupons on a refunded purchase are voided.
