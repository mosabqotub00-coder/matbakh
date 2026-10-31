CREATE TABLE `developer_errors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int,
	`user_id` int,
	`severity` enum('info','warning','error','critical') NOT NULL DEFAULT 'error',
	`source` varchar(80) NOT NULL,
	`message` text NOT NULL,
	`route` varchar(255),
	`details` text,
	`status` enum('new','investigating','resolved','ignored') NOT NULL DEFAULT 'new',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`resolved_at` timestamp,
	`resolved_by_id` int,
	CONSTRAINT `developer_errors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feature_key` varchar(120) NOT NULL,
	`display_name` varchar(160) NOT NULL,
	`description` text,
	`target` enum('developer','branch','all') NOT NULL DEFAULT 'developer',
	`branch_id` int,
	`enabled` boolean NOT NULL DEFAULT false,
	`created_by_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feature_flags_id` PRIMARY KEY(`id`),
	CONSTRAINT `feature_flags_feature_target_uq` UNIQUE(`feature_key`,`target`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `release_manifests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`version` varchar(40) NOT NULL,
	`title` varchar(160) NOT NULL,
	`notes` text,
	`artifact_name` varchar(160),
	`artifact_data` longblob,
	`artifact_size` int,
	`status` enum('uploaded','testing','approved','deployed','rolled_back') NOT NULL DEFAULT 'uploaded',
	`target` enum('developer','branch','all') NOT NULL DEFAULT 'developer',
	`target_branch_id` int,
	`created_by_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `release_manifests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int,
	`user_id` int NOT NULL,
	`order_id` int,
	`title` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`attachment_data` longblob,
	`attachment_name` varchar(160),
	`attachment_type` varchar(120),
	`status` enum('new','investigating','resolved','closed') NOT NULL DEFAULT 'new',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`resolved_by_id` int,
	CONSTRAINT `staff_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `staff_users` MODIFY COLUMN `role` enum('developer','system_admin','branch_manager','kitchen_manager','shift_manager','station','kitchen') NOT NULL DEFAULT 'station';--> statement-breakpoint
CREATE INDEX `developer_errors_branch_created_idx` ON `developer_errors` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `developer_errors_status_idx` ON `developer_errors` (`status`);--> statement-breakpoint
CREATE INDEX `release_manifests_version_idx` ON `release_manifests` (`version`);--> statement-breakpoint
CREATE INDEX `release_manifests_status_idx` ON `release_manifests` (`status`);--> statement-breakpoint
CREATE INDEX `staff_feedback_branch_created_idx` ON `staff_feedback` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `staff_feedback_status_idx` ON `staff_feedback` (`status`);
