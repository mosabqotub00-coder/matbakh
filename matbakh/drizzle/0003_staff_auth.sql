CREATE TABLE `staff_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_sessions_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`password_hash` varchar(180) NOT NULL,
	`can_station` boolean NOT NULL DEFAULT false,
	`can_kitchen` boolean NOT NULL DEFAULT false,
	`can_manager` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`must_change_password` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staff_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_users_username_uq` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE INDEX `staff_sessions_user_expiry_idx` ON `staff_sessions` (`user_id`,`expires_at`);