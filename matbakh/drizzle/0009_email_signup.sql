ALTER TABLE `staff_users` ADD COLUMN `email` varchar(320) NULL;
--> statement-breakpoint
ALTER TABLE `staff_users` ADD COLUMN `approval_status` enum('approved','pending') NOT NULL DEFAULT 'approved';
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_email_uq` ON `staff_users` (`email`);
