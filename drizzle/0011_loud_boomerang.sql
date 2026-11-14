ALTER TABLE `coupons` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `refund_state` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `decline_reason` text;